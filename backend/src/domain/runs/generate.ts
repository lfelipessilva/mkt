import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import {
  isSiloEnabled,
  uploadCarouselToSilo,
  downloadMediaFromSilo,
} from "../../shared/storage/silo.js";
import { getAccount } from "../accounts/store.js";
import {
  toPortableOutputPath,
  getOutputDir,
  safeResolveMediaPath,
} from "../media/paths.js";
import { recordMediaUsage, upsertMediaAsset } from "../media/store.js";
import { selectCarouselForAccount } from "../../pipeline/select.js";
import {
  generateCarouselCopy,
  type GeneratedCarouselCopy,
} from "../../pipeline/gemini.js";
import { renderCarousel, type RenderSlideInput } from "../../pipeline/render.js";
import type { CarouselRun, CarouselSlide, GenerationJobProgress } from "./schemas.js";
import {
  createCarouselRun,
  createCarouselSlides,
  createGenerationJob,
  updateGenerationJob,
  getGenerationJobProgress,
} from "./store.js";

export { getOutputDir };

export type MediaBytesLoader = (storagePath: string) => Promise<Buffer>;

export interface GenerateOneCarouselOptions {
  accountId: string;
  jobId?: string | null;
  mockCopy?: GeneratedCarouselCopy;
  skipRender?: boolean;
  pool?: Pool;
  mediaRoot?: string;
  outputDir?: string;
  mediaBytesLoader?: MediaBytesLoader;
  geminiApiKey?: string;
  geminiModel?: string;
  now?: number;
}

export function dayStamp(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function nextPostIndex(accountDayDir: string): number {
  if (!fs.existsSync(accountDayDir)) return 1;
  const nums = fs
    .readdirSync(accountDayDir)
    .map((name) => /^post_(\d+)/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m![1]));
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

async function resolveSlideMediaId(
  slide: { filename: string; path: string },
  _mediaRoot: string | undefined,
  pool: Pool
): Promise<string | null> {
  const normPath = slide.path.replace(/\\/g, "/");
  const storageWithMedia = normPath.startsWith("media/") ? normPath : path.posix.join("media", normPath);
  const storagePlain = normPath.startsWith("media/") ? normPath.slice(6) : normPath;

  // 1. Look up by storage_path
  const byPath = await pool.query<{ id: string }>(
    `SELECT id FROM media_assets WHERE storage_path = $1 OR storage_path = $2 LIMIT 1`,
    [storageWithMedia, storagePlain]
  );
  if (byPath.rows[0]) {
    return byPath.rows[0].id;
  }

  // 2. Look up by filename
  const byFilename = await pool.query<{ id: string }>(
    `SELECT id FROM media_assets WHERE filename = $1 LIMIT 1`,
    [slide.filename]
  );
  if (byFilename.rows[0]) {
    return byFilename.rows[0].id;
  }

  // 3. Fallback: try to upsert if file path structure matches
  try {
    const rel = normPath.startsWith("media/") ? normPath.slice(6) : normPath;
    const parts = rel.split("/");
    if (parts.length >= 3) {
      const scope = parts[0] as any;
      const category = (parts[1] === "capas" ? "cover" : parts[1] === "aleatorias" ? "random" : parts[1]) as any;
      const asset = await upsertMediaAsset(
        {
          scope,
          category,
          storage_path: storageWithMedia,
          filename: slide.filename,
        },
        pool
      );
      return asset.id;
    } else if (parts.length === 2 && parts[0] === "listo") {
      const asset = await upsertMediaAsset(
        {
          scope: "listo",
          category: "listo",
          storage_path: storageWithMedia,
          filename: slide.filename,
        },
        pool
      );
      return asset.id;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function generateOneCarousel(
  options: GenerateOneCarouselOptions
): Promise<CarouselRun> {
  const p = options.pool || getPool();

  if (process.env.NODE_ENV === "production" && !isSiloEnabled()) {
    throw new AppError("Silo storage is required in production", 503, "silo_disabled");
  }

  const account = await getAccount(options.accountId, p);
  if (!account) {
    throw new AppError(`Account not found: ${options.accountId}`, 404, "not_found");
  }

  const selection = await selectCarouselForAccount(options.accountId, {
    pool: p,
    mediaRoot: options.mediaRoot,
    now: options.now,
  });

  let copy: GeneratedCarouselCopy;
  if (options.mockCopy) {
    copy = options.mockCopy;
  } else {
    const apiKey = options.geminiApiKey || process.env.GEMINI_API_KEY || "";
    const model = options.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    copy = await generateCarouselCopy({
      apiKey,
      model,
      persona: selection.persona,
      arquetipoTitulo: selection.arquetipoTitulo,
      baitTrigger: selection.baitTrigger,
      slides: selection.slides,
    });
  }

  const textsByNumero = new Map<number | string, string>(
    copy.slides.map((s) => [s.numero, s.texto])
  );

  const outputRoot = getOutputDir(options.outputDir);
  const dateStamp = dayStamp(options.now ? new Date(options.now) : new Date());
  const accountDayDir = path.join(outputRoot, dateStamp, account.id);
  const index = nextPostIndex(accountDayDir);
  const outDir = path.join(accountDayDir, `post_${String(index).padStart(2, "0")}`);
  fs.mkdirSync(outDir, { recursive: true });

  if (!options.skipRender) {
    const renderSlides: RenderSlideInput[] = [];
    for (const slide of selection.slides) {
      let buffer: Buffer | undefined;

      if (options.mediaBytesLoader) {
        buffer = await options.mediaBytesLoader(slide.path);
      } else if (fs.existsSync(slide.path)) {
        // direct path exists on disk
      } else {
        let diskResolved: string | null = null;
        try {
          const resolved = safeResolveMediaPath(slide.path);
          if (fs.existsSync(resolved)) {
            diskResolved = resolved;
          }
        } catch {
          // ignore
        }

        if (diskResolved) {
          renderSlides.push({
            numero: slide.numero,
            path: diskResolved,
          });
          continue;
        } else if (isSiloEnabled()) {
          buffer = await downloadMediaFromSilo(slide.path);
        } else {
          throw new AppError(
            `Cannot render slide ${slide.numero}: media '${slide.path}' not found on disk and Silo is not enabled`,
            500,
            "media_not_found"
          );
        }
      }

      renderSlides.push({
        numero: slide.numero,
        path: slide.path,
        buffer,
      });
    }

    await renderCarousel({
      slides: renderSlides,
      textsByNumero,
      outDir,
    });
  }

  const metaContent = JSON.stringify(
    {
      selection: { ...selection, usageUpdate: undefined },
      copy,
    },
    null,
    2
  );
  fs.writeFileSync(path.join(outDir, "meta.json"), metaContent);

  // Upload generated carousel slides and meta.json to Silo if enabled
  if (isSiloEnabled()) {
    const relOutDir = path.relative(outputRoot, outDir).replace(/\\/g, "/");
    await uploadCarouselToSilo(
      path.posix.join(relOutDir, "meta.json"),
      metaContent,
      "application/json"
    );

    if (!options.skipRender) {
      for (const slide of selection.slides) {
        const slideFile = path.join(outDir, `slide_${slide.numero}.jpg`);
        if (fs.existsSync(slideFile)) {
          const buf = fs.readFileSync(slideFile);
          await uploadCarouselToSilo(
            path.posix.join(relOutDir, `slide_${slide.numero}.jpg`),
            buf,
            "image/jpeg"
          );
        }
      }
    }
  }

  const portableOutDir = toPortableOutputPath(outDir, outputRoot);

  // Create CarouselRun row in database
  const run = await createCarouselRun(
    {
      job_id: options.jobId ?? null,
      account_id: account.id,
      account_role: selection.role,
      archetype_title: selection.arquetipoTitulo,
      bait_body: selection.baitTrigger,
      tema: copy.tema_escolhido,
      legenda: copy.legenda_tiktok,
      status: "generated",
      output_dir: portableOutDir,
      generated_at: new Date(options.now ?? Date.now()),
    },
    p
  );

  // Resolve media_id for each slide
  const slideInputs: Array<{
    run_id: string;
    position: number;
    storage_path: string;
    media_id: string | null;
  }> = [];

  const usedMediaIds: string[] = [];

  for (let i = 0; i < selection.slides.length; i++) {
    const slide = selection.slides[i];
    const mediaId = await resolveSlideMediaId(
      slide,
      options.mediaRoot,
      p
    );
    if (mediaId) {
      usedMediaIds.push(mediaId);
    }
    const slideStoragePath = path.posix.join(portableOutDir, `slide_${slide.numero}.jpg`);
    slideInputs.push({
      run_id: run.id,
      position: slide.numero,
      storage_path: slideStoragePath,
      media_id: mediaId,
    });
  }

  // Create CarouselSlide rows in database
  const createdSlides = await createCarouselSlides(slideInputs, p);

  // Record media usage in Postgres
  if (usedMediaIds.length > 0) {
    await recordMediaUsage(
      run.id,
      usedMediaIds,
      p,
      new Date(options.now ?? Date.now())
    );
  }

  run.slides = createdSlides;
  return run;
}

export interface GenerateBatchOptions {
  accountIds?: string[];
  mockCopy?: GeneratedCarouselCopy;
  skipRender?: boolean;
  pool?: Pool;
  mediaRoot?: string;
  outputDir?: string;
  mediaBytesLoader?: MediaBytesLoader;
  geminiApiKey?: string;
  geminiModel?: string;
  now?: number;
}

export interface GenerateBatchResult {
  job: GenerationJobProgress;
  runs: CarouselRun[];
}

export async function generateBatch(
  options: GenerateBatchOptions = {}
): Promise<GenerateBatchResult> {
  const p = options.pool || getPool();

  let targetAccountIds: string[];
  if (options.accountIds !== undefined) {
    // Validate that each requested account exists
    for (const accountId of options.accountIds) {
      const account = await getAccount(accountId, p);
      if (!account) {
        throw new AppError(`Account not found: ${accountId}`, 404, "not_found");
      }
    }
    targetAccountIds = options.accountIds;
  } else {
    // When omitted, select all enabled accounts
    const enabledRes = await p.query<{ id: string }>(
      `SELECT id FROM accounts WHERE enabled = true ORDER BY created_at ASC, id ASC`
    );
    targetAccountIds = enabledRes.rows.map((r) => r.id);
  }

  // Create job row in database
  const job = await createGenerationJob(
    {
      account_ids: targetAccountIds,
      status: "running",
      started_at: new Date(options.now ?? Date.now()),
    },
    p
  );

  const runs: CarouselRun[] = [];
  let hasError = false;
  let lastErrorMessage: string | null = null;

  for (const accountId of targetAccountIds) {
    try {
      const run = await generateOneCarousel({
        accountId,
        jobId: job.id,
        mockCopy: options.mockCopy,
        skipRender: options.skipRender,
        pool: p,
        mediaRoot: options.mediaRoot,
        outputDir: options.outputDir,
        mediaBytesLoader: options.mediaBytesLoader,
        geminiApiKey: options.geminiApiKey,
        geminiModel: options.geminiModel,
        now: options.now,
      });
      runs.push(run);
    } catch (err: any) {
      hasError = true;
      lastErrorMessage = err?.message || String(err);
    }
  }

  const finalStatus = hasError && runs.length === 0 ? "failed" : "completed";
  await updateGenerationJob(
    job.id,
    {
      status: finalStatus,
      error_message: hasError ? lastErrorMessage : null,
      finished_at: new Date(options.now ?? Date.now()),
    },
    p
  );

  const progress = await getGenerationJobProgress(job.id, p);

  return {
    job: progress!,
    runs,
  };
}
