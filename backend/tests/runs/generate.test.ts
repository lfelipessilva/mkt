import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import sharp from "sharp";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { replaceArchetypesForScope } from "../../src/domain/archetypes/store.js";
import { replaceBaitsForScope } from "../../src/domain/baits/store.js";
import { upsertMediaAsset, recentlyUsedFilenames } from "../../src/domain/media/store.js";
import { generateOneCarousel } from "../../src/domain/runs/generate.js";
import {
  getCarouselRun,
  listCarouselRuns,
  updateCarouselRun,
  deleteCarouselRun,
} from "../../src/domain/runs/store.js";

const { Pool } = pg;

describe("Task 11: Persist runs + slides on generate", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let tmpMediaDir: string;
  let tmpOutputDir: string;

  const mockCopy = {
    tema_escolhido: "Dicas de Estilo para Mulheres Elegantes",
    slides: [
      {
        numero: 1,
        imagem_ref: "capa_01.jpg",
        texto: "5 Peças Essenciais Para o Seu Guarda-Roupa",
      },
      {
        numero: 2,
        imagem_ref: "aleat_01.jpg",
        texto: "1. Uma camisa de linho bem cortada",
      },
      {
        numero: 3,
        imagem_ref: "aleat_02.jpg",
        texto: "2. Calça de alfaiataria em tom neutro",
      },
      {
        numero: 4,
        imagem_ref: "shared_01.jpg",
        texto: "3. Blazer oversized estruturado",
      },
      {
        numero: 5,
        imagem_ref: "shared_02.jpg",
        texto: "4. Acessórios minimalistas de ouro",
      },
      {
        numero: 6,
        imagem_ref: "listo_01.png",
        texto: "Gostou das dicas? Salve este post e compartilhe!",
      },
    ],
    legenda_tiktok: "Confira as peças essenciais que elevam qualquer look! #moda #elegancia #estilo",
  };

  before(async () => {
    let connectionString = process.env.TEST_DATABASE_URL;

    if (!connectionString) {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      connectionString = container.getConnectionUri();
      process.env.DATABASE_URL = connectionString;
    }

    pool = new Pool({ connectionString });
    await runMigrations(pool);

    // Create temporary media root with sample images
    tmpMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "task11-media-"));
    tmpOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "task11-output-"));

    const dirs = [
      path.join(tmpMediaDir, "single_woman", "capas"),
      path.join(tmpMediaDir, "single_woman", "aleatorias"),
      path.join(tmpMediaDir, "shared", "aleatorias"),
      path.join(tmpMediaDir, "shared", "listo"),
    ];
    for (const d of dirs) {
      fs.mkdirSync(d, { recursive: true });
    }

    // Helper to generate a valid test image
    const createTestImage = async (dest: string) => {
      await sharp({
        create: {
          width: 1080,
          height: 1920,
          channels: 3,
          background: { r: 120, g: 150, b: 200 },
        },
      })
        .jpeg()
        .toFile(dest);
    };

    await createTestImage(path.join(tmpMediaDir, "single_woman", "capas", "capa_01.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_woman", "capas", "capa_02.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_woman", "capas", "capa_03.jpg"));

    await createTestImage(path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_01.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_02.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_03.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_04.jpg"));

    await createTestImage(path.join(tmpMediaDir, "shared", "aleatorias", "shared_01.jpg"));
    await createTestImage(path.join(tmpMediaDir, "shared", "aleatorias", "shared_02.jpg"));
    await createTestImage(path.join(tmpMediaDir, "shared", "aleatorias", "shared_03.jpg"));

    await createTestImage(path.join(tmpMediaDir, "shared", "listo", "listo_01.png"));
    await createTestImage(path.join(tmpMediaDir, "shared", "listo", "listo_02.png"));
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE media_usage, carousel_slides, carousel_runs, generation_jobs, media_assets, baits, archetypes, accounts CASCADE;");

    // Clean output directory for each test
    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
      fs.mkdirSync(tmpOutputDir, { recursive: true });
    }

    // Seed account
    await upsertAccount(
      {
        id: "acc_woman_elegante",
        persona: "Mulher madura, elegante e prática",
        role: "single_woman",
        enabled: true,
      },
      pool
    );

    // Seed archetypes & baits
    await replaceArchetypesForScope(
      "single_woman",
      [{ title: "Guarda-Roupa Inteligente", sort_order: 1 }],
      pool
    );
    await replaceBaitsForScope(
      "single_woman",
      [{ body: "Você ainda comete esse erro clássico?", sort_order: 1 }],
      pool
    );

    // Seed media assets in DB
    const seedMedia = [
      { scope: "single_woman", category: "cover", filename: "capa_01.jpg", path: path.join(tmpMediaDir, "single_woman", "capas", "capa_01.jpg") },
      { scope: "single_woman", category: "cover", filename: "capa_02.jpg", path: path.join(tmpMediaDir, "single_woman", "capas", "capa_02.jpg") },
      { scope: "single_woman", category: "cover", filename: "capa_03.jpg", path: path.join(tmpMediaDir, "single_woman", "capas", "capa_03.jpg") },
      { scope: "single_woman", category: "random", filename: "aleat_01.jpg", path: path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_01.jpg") },
      { scope: "single_woman", category: "random", filename: "aleat_02.jpg", path: path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_02.jpg") },
      { scope: "single_woman", category: "random", filename: "aleat_03.jpg", path: path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_03.jpg") },
      { scope: "single_woman", category: "random", filename: "aleat_04.jpg", path: path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_04.jpg") },
      { scope: "shared", category: "random", filename: "shared_01.jpg", path: path.join(tmpMediaDir, "shared", "aleatorias", "shared_01.jpg") },
      { scope: "shared", category: "random", filename: "shared_02.jpg", path: path.join(tmpMediaDir, "shared", "aleatorias", "shared_02.jpg") },
      { scope: "shared", category: "random", filename: "shared_03.jpg", path: path.join(tmpMediaDir, "shared", "aleatorias", "shared_03.jpg") },
      { scope: "shared", category: "listo", filename: "listo_01.png", path: path.join(tmpMediaDir, "shared", "listo", "listo_01.png") },
      { scope: "shared", category: "listo", filename: "listo_02.png", path: path.join(tmpMediaDir, "shared", "listo", "listo_02.png") },
    ];
    for (const m of seedMedia) {
      await upsertMediaAsset(
        {
          scope: m.scope as any,
          category: m.category as any,
          storage_path: m.path,
          filename: m.filename,
        },
        pool
      );
    }
  });

  after(async () => {
    await closePool();
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
    if (tmpMediaDir && fs.existsSync(tmpMediaDir)) {
      fs.rmSync(tmpMediaDir, { recursive: true, force: true });
    }
    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
    }
  });

  describe("Step 1: Test with skipRender: true, mockCopy -> DB rows status = generated, slides count >= 1", () => {
    it("persists run, slides, media_usage and writes output meta.json without rendering images", async () => {
      const run = await generateOneCarousel({
        accountId: "acc_woman_elegante",
        mockCopy,
        skipRender: true,
        pool,
        mediaRoot: tmpMediaDir,
        outputDir: tmpOutputDir,
      });

      // 1. Verify returned CarouselRun
      assert.ok(run.id, "run.id should be defined");
      assert.equal(run.account_id, "acc_woman_elegante");
      assert.equal(run.account_role, "single_woman");
      assert.equal(run.archetype_title, "Guarda-Roupa Inteligente");
      assert.equal(run.status, "generated");
      assert.equal(run.tema, mockCopy.tema_escolhido);
      assert.equal(run.legenda, mockCopy.legenda_tiktok);
      assert.ok(run.output_dir, "run.output_dir should be set");
      assert.ok(run.generated_at, "run.generated_at should be set");
      assert.ok(Array.isArray(run.slides), "run.slides should be an array");
      assert.ok(run.slides.length >= 1, "slides count should be >= 1");

      // 2. Verify carousel_runs table in DB
      const dbRunResult = await pool.query(
        "SELECT * FROM carousel_runs WHERE id = $1",
        [run.id]
      );
      assert.equal(dbRunResult.rows.length, 1);
      const dbRun = dbRunResult.rows[0];
      assert.equal(dbRun.status, "generated");
      assert.equal(dbRun.account_id, "acc_woman_elegante");
      assert.equal(dbRun.account_role, "single_woman");
      assert.equal(dbRun.archetype_title, "Guarda-Roupa Inteligente");
      assert.equal(dbRun.tema, mockCopy.tema_escolhido);
      assert.equal(dbRun.legenda, mockCopy.legenda_tiktok);

      // 3. Verify carousel_slides table in DB
      const dbSlidesResult = await pool.query(
        "SELECT * FROM carousel_slides WHERE run_id = $1 ORDER BY position ASC",
        [run.id]
      );
      assert.equal(dbSlidesResult.rows.length, run.slides.length);
      assert.ok(dbSlidesResult.rows.length >= 1);

      for (let i = 0; i < dbSlidesResult.rows.length; i++) {
        const slide = dbSlidesResult.rows[i];
        assert.equal(slide.position, i + 1);
        assert.ok(slide.storage_path.includes("slide_"));
        assert.ok(slide.media_id, "media_id should be linked");
      }

      // 4. Verify media_usage table in DB
      const dbUsageResult = await pool.query(
        "SELECT * FROM media_usage WHERE run_id = $1",
        [run.id]
      );
      assert.equal(dbUsageResult.rows.length, run.slides.length);

      assert.ok(run.output_dir!.startsWith("output/"), "output_dir should be portable");
      assert.ok(
        run.slides!.every((s) => s.storage_path.startsWith("output/")),
        "slide storage_path should be portable"
      );

      // 5. Verify filesystem: meta.json exists under output_dir
      const absOutDir = path.join(tmpOutputDir, run.output_dir!.replace(/^output\//, ""));
      assert.ok(fs.existsSync(absOutDir));
      const metaPath = path.join(absOutDir, "meta.json");
      assert.ok(fs.existsSync(metaPath), "meta.json should be written");
      const metaContent = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      assert.equal(metaContent.copy.tema_escolhido, mockCopy.tema_escolhido);

      // Verify that slide images were NOT rendered because skipRender was true
      const slide1Path = path.join(absOutDir, "slide_1.jpg");
      assert.equal(fs.existsSync(slide1Path), false, "slide_1.jpg should not exist when skipRender is true");
    });
  });

  describe("Step 2: Port render + gemini from legacy run.js; single iteration", () => {
    it("renders slide jpeg images when skipRender is false and writes them to output", async () => {
      const run = await generateOneCarousel({
        accountId: "acc_woman_elegante",
        mockCopy,
        skipRender: false,
        pool,
        mediaRoot: tmpMediaDir,
        outputDir: tmpOutputDir,
      });

      assert.equal(run.status, "generated");
      assert.ok(run.output_dir);
      const absOutDir = path.join(tmpOutputDir, run.output_dir!.replace(/^output\//, ""));
      assert.ok(fs.existsSync(absOutDir));

      // Verify each slide has a rendered image on disk
      for (const slide of run.slides!) {
        const absSlide = path.join(tmpOutputDir, slide.storage_path.replace(/^output\//, ""));
        assert.ok(fs.existsSync(absSlide), `File should exist at ${absSlide}`);
        const meta = await sharp(absSlide).metadata();
        assert.equal(meta.width, 1080);
        assert.equal(meta.height, 1920);
        assert.equal(meta.format, "jpeg");
      }

      // Verify meta.json exists
      assert.ok(fs.existsSync(path.join(absOutDir, "meta.json")));
    });

    it("increments postIndex directory on consecutive generations on same day", async () => {
      const run1 = await generateOneCarousel({
        accountId: "acc_woman_elegante",
        mockCopy,
        skipRender: true,
        pool,
        mediaRoot: tmpMediaDir,
        outputDir: tmpOutputDir,
      });

      const run2 = await generateOneCarousel({
        accountId: "acc_woman_elegante",
        mockCopy,
        skipRender: true,
        pool,
        mediaRoot: tmpMediaDir,
        outputDir: tmpOutputDir,
      });

      assert.ok(run1.output_dir!.endsWith("post_01"), `Expected post_01 but got ${run1.output_dir}`);
      assert.ok(run2.output_dir!.endsWith("post_02"), `Expected post_02 but got ${run2.output_dir}`);
    });

    it("links optional jobId to the carousel_run row", async () => {
      // Create a generation job
      const jobResult = await pool.query(
        "INSERT INTO generation_jobs (account_ids, status) VALUES ($1, 'running') RETURNING id",
        [["acc_woman_elegante"]]
      );
      const jobId = jobResult.rows[0].id;

      const run = await generateOneCarousel({
        accountId: "acc_woman_elegante",
        jobId,
        mockCopy,
        skipRender: true,
        pool,
        mediaRoot: tmpMediaDir,
        outputDir: tmpOutputDir,
      });

      assert.equal(run.job_id, jobId);
      const dbRun = await getCarouselRun(run.id, pool);
      assert.equal(dbRun?.job_id, jobId);
    });

    it("excludes recently used media in subsequent selections via Postgres media_usage", async () => {
      // First generation records media usage
      const run = await generateOneCarousel({
        accountId: "acc_woman_elegante",
        mockCopy,
        skipRender: true,
        pool,
        mediaRoot: tmpMediaDir,
        outputDir: tmpOutputDir,
      });

      const used = await recentlyUsedFilenames("single_woman", 7, pool);
      assert.ok(used.size >= 1, "recently used filenames should have entries");

      // Verify all slide media assets used in the run are present in used filenames
      const runSlides = await pool.query<{ filename: string }>(
        "SELECT ma.filename FROM carousel_slides cs JOIN media_assets ma ON cs.media_id = ma.id WHERE cs.run_id = $1",
        [run.id]
      );
      assert.ok(runSlides.rows.length >= 1);
      for (const row of runSlides.rows) {
        assert.ok(used.has(row.filename), `Used filenames should contain ${row.filename}`);
      }
    });

    it("supports store methods: listCarouselRuns, updateCarouselRun, deleteCarouselRun", async () => {
      const run = await generateOneCarousel({
        accountId: "acc_woman_elegante",
        mockCopy,
        skipRender: true,
        pool,
        mediaRoot: tmpMediaDir,
        outputDir: tmpOutputDir,
      });

      // 1. listCarouselRuns
      const runs = await listCarouselRuns({ accountId: "acc_woman_elegante" }, pool);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].id, run.id);

      // 2. updateCarouselRun
      const updated = await updateCarouselRun(
        run.id,
        { status: "dispatched" },
        pool
      );
      assert.equal(updated.status, "dispatched");
      const fetched = await getCarouselRun(run.id, pool);
      assert.equal(fetched?.status, "dispatched");

      // 3. deleteCarouselRun (cascades to slides & media_usage)
      const deleted = await deleteCarouselRun(run.id, pool);
      assert.equal(deleted, true);

      const afterDelete = await getCarouselRun(run.id, pool);
      assert.equal(afterDelete, null);

      const slidesAfterDelete = await pool.query(
        "SELECT * FROM carousel_slides WHERE run_id = $1",
        [run.id]
      );
      assert.equal(slidesAfterDelete.rows.length, 0);

      const usageAfterDelete = await pool.query(
        "SELECT * FROM media_usage WHERE run_id = $1",
        [run.id]
      );
      assert.equal(usageAfterDelete.rows.length, 0);
    });

    it("throws 404 when account does not exist", async () => {
      await assert.rejects(
        async () => {
          await generateOneCarousel({
            accountId: "non_existent_account",
            mockCopy,
            skipRender: true,
            pool,
            mediaRoot: tmpMediaDir,
            outputDir: tmpOutputDir,
          });
        },
        {
          name: "AppError",
          statusCode: 404,
        }
      );
    });
  });
});
