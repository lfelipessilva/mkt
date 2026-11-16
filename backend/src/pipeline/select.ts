import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Pool } from "pg";
import { getPool } from "../shared/db/client.js";
import { AppError } from "../shared/errors.js";
import {
  AccountRoleSchema,
  type AccountRole,
} from "../domain/accounts/schemas.js";
import { getAccount } from "../domain/accounts/store.js";
import { loadEffectiveForAccount } from "../domain/content/effective.js";
import {
  getUsageDays,
  recordMediaUsage,
  recentlyUsedFilenames,
  listActiveMediaImages,
} from "../domain/media/store.js";
import type { Archetype } from "../domain/archetypes/schemas.js";
import type { Bait } from "../domain/baits/schemas.js";

export { getUsageDays, recordMediaUsage, recentlyUsedFilenames };

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

export interface MediaDirs {
  capas: string;
  aleatoriasRole: string;
  aleatoriasShared: string;
  listo: string;
}

export interface MediaImage {
  filename: string;
  path: string;
}

export interface UsageEntry {
  filename: string;
  at: string;
}

export interface BaitUsageEntry {
  bait: string;
  at: string;
}

export interface UsageData {
  entries?: UsageEntry[];
  baits?: BaitUsageEntry[];
}

export interface SlideSelection {
  numero: number;
  filename: string;
  path: string;
  isListo: boolean;
  isCapa: boolean;
}

export interface CarouselSelection {
  role: AccountRole;
  accountId?: string;
  persona?: string;
  arquetipoTitulo: string;
  baitTrigger: string | null;
  slides: SlideSelection[];
  usageUpdate: {
    entries: UsageEntry[];
    baits: BaitUsageEntry[];
  };
}

export interface SelectCarouselInput {
  role: AccountRole;
  archetypes: Array<string | Pick<Archetype, "title">>;
  baits?: Array<string | Pick<Bait, "body">>;
  pool?: Pool;
  mediaRoot?: string;
  persona?: string;
  accountId?: string;
  usage?: UsageData | null;
  usedFilenames?: Set<string>;
  usageDays?: number;
  randomCount?: number;
  aleatoriasCount?: number;
  now?: number;
  pools?: {
    cover?: MediaImage[];
    random?: MediaImage[];
    listo?: MediaImage[];
  };
}

export function unionImages(...pools: MediaImage[][]): MediaImage[] {
  const seen = new Set<string>();
  const out: MediaImage[] = [];
  for (const pool of pools) {
    for (const img of pool) {
      if (seen.has(img.filename)) continue;
      seen.add(img.filename);
      out.push(img);
    }
  }
  return out;
}

export function loadUsage(usagePath: string): UsageData {
  if (!existsSync(usagePath)) return { entries: [], baits: [] };
  try {
    const raw = JSON.parse(readFileSync(usagePath, "utf8"));
    return {
      entries: raw.entries || [],
      baits: raw.baits || [],
    };
  } catch {
    return { entries: [], baits: [] };
  }
}

export function saveUsage(usagePath: string, usage: UsageData): void {
  mkdirSync(join(usagePath, ".."), { recursive: true });
  writeFileSync(usagePath, JSON.stringify(usage, null, 2));
}

export function pruneUsage(usage?: UsageData | null, days = 7, now = Date.now()): {
  entries: UsageEntry[];
  baits: BaitUsageEntry[];
} {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return {
    entries: (usage?.entries || []).filter((e) => new Date(e.at).getTime() >= cutoff),
    baits: (usage?.baits || []).filter((e) => new Date(e.at).getTime() >= cutoff),
  };
}

export function recentlyUsedBaits(usage?: UsageData | null): Set<string> {
  return new Set((usage?.baits || []).map((e) => e.bait));
}

export function filenameStem(filename: string): string {
  return basename(filename).replace(IMAGE_RE, "");
}

export function categoryPrefix(filename: string): string {
  const stem = filenameStem(filename);
  const i = stem.indexOf("_");
  return (i > 0 ? stem.slice(0, i) : stem).toLowerCase();
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function available(pool: MediaImage[], used: Set<string>, need = 1): MediaImage[] {
  const free = pool.filter((img) => !used.has(img.filename));
  return free.length >= need ? free : pool;
}

function pickBait(baits: string[], usedBaits: Set<string>): string {
  const free = baits.filter((b) => !usedBaits.has(b));
  return pickRandom(free.length ? free : baits);
}

export async function selectCarousel({
  pool,
  role,
  archetypes,
  baits = [],
  persona,
  accountId,
  usage,
  usedFilenames,
  usageDays,
  randomCount,
  aleatoriasCount,
  now = Date.now(),
  pools,
}: SelectCarouselInput): Promise<CarouselSelection> {
  if (!AccountRoleSchema.safeParse(role).success) {
    throw new Error(`role inválido: ${role}`);
  }

  if (!Array.isArray(archetypes) || archetypes.length === 0) {
    throw new Error(`arquétipos ausentes pra conta: ${accountId ?? role}`);
  }

  const archetypeTitles: string[] = archetypes.map((a) =>
    typeof a === "string" ? a : a.title
  );

  const baitBodies: string[] = (baits || []).map((b) =>
    typeof b === "string" ? b : b.body
  );

  const effectiveUsageDays = getUsageDays(usageDays);
  const pruned = pruneUsage(usage, effectiveUsageDays, now);
  const legacyUsed = new Set((pruned.entries || []).map((e) => e.filename));
  const used = usedFilenames
    ? new Set([...usedFilenames, ...legacyUsed])
    : legacyUsed;
  const usedBaits = recentlyUsedBaits(pruned);

  const p = pool || getPool();

  const coverPool =
    pools?.cover ?? (await listActiveMediaImages([role], "cover", p));
  const randomPool =
    pools?.random ??
    unionImages(
      await listActiveMediaImages([role], "random", p),
      await listActiveMediaImages(["shared"], "random", p)
    );
  const listoPool =
    pools?.listo ??
    (await listActiveMediaImages(["listo", "shared"], "listo", p));

  if (!coverPool.length || !listoPool.length || randomPool.length < 3) {
    throw new Error(
      `mídia insuficiente (${role}): cover=${coverPool.length} random=${randomPool.length} listo=${listoPool.length}`
    );
  }

  const targetCount = randomCount ?? aleatoriasCount ?? (Math.random() < 0.5 ? 3 : 4);
  const count = Math.min(targetCount, randomPool.length);

  const cover = pickRandom(available(coverPool, used));
  const listo = pickRandom(
    available(
      listoPool.filter((i) => i.filename !== cover.filename),
      used
    )
  );

  const pickedRandom: MediaImage[] = [];
  const usedCategories = new Set<string>();
  const availableRandomPool = available(
    randomPool.filter((i) => i.filename !== cover.filename && i.filename !== listo.filename),
    used,
    count
  );
  const shuffledRandom = shuffle(availableRandomPool);

  for (const img of shuffledRandom) {
    if (pickedRandom.length >= count) break;
    const cat = categoryPrefix(img.filename);
    if (usedCategories.has(cat)) continue;
    usedCategories.add(cat);
    pickedRandom.push(img);
  }

  if (pickedRandom.length < count) {
    for (const img of shuffledRandom) {
      if (pickedRandom.length >= count) break;
      if (pickedRandom.includes(img)) continue;
      pickedRandom.push(img);
    }
  }

  if (pickedRandom.length < count) {
    throw new Error(`não deu pra sortear ${count} imagens random`);
  }

  const mid = shuffle([...pickedRandom]);
  const listoAt = mid.length - (mid.length > 1 && Math.random() < 0.5 ? 1 : 0);
  mid.splice(listoAt, 0, listo);

  const slides: SlideSelection[] = [cover, ...mid].map((img, i) => ({
    numero: i + 1,
    filename: img.filename,
    path: img.path,
    isListo: img === listo || /listo/i.test(img.filename),
    isCapa: i === 0,
  }));

  const arquetipoTitulo = pickRandom(archetypeTitles);
  const baitTrigger =
    baitBodies.length > 0 && Math.random() < 0.5
      ? pickBait(baitBodies, usedBaits)
      : null;
  const at = new Date(now).toISOString();

  return {
    role,
    accountId,
    persona,
    arquetipoTitulo,
    baitTrigger,
    slides,
    usageUpdate: {
      entries: [
        ...pruned.entries,
        ...slides.map((s) => ({ filename: s.filename, at })),
      ],
      baits: baitTrigger
        ? [...pruned.baits, { bait: baitTrigger, at }]
        : pruned.baits,
    },
  };
}

export function recordUsage(usagePath: string, usageUpdate: UsageData): void {
  saveUsage(usagePath, usageUpdate);
}

export async function selectCarouselForAccount(
  accountId: string,
  options: {
    pool?: Pool;
    mediaRoot?: string;
    usage?: UsageData;
    usedFilenames?: Set<string>;
    usageDays?: number;
    randomCount?: number;
    aleatoriasCount?: number;
    now?: number;
  } = {}
): Promise<CarouselSelection> {
  const p = options.pool || getPool();
  const account = await getAccount(accountId, p);
  if (!account) {
    throw new AppError(`Account not found: ${accountId}`, 404, "not_found");
  }

  const effective = await loadEffectiveForAccount(accountId, p, {
    activeOnly: true,
  });

  const usageDays = getUsageDays(options.usageDays);

  let usedFilenames = options.usedFilenames;
  if (!usedFilenames && !options.usage) {
    try {
      usedFilenames = await recentlyUsedFilenames(account.role, usageDays, p);
    } catch {
      usedFilenames = new Set<string>();
    }
  }

  return selectCarousel({
    pool: p,
    role: account.role,
    archetypes: effective.archetypes,
    baits: effective.baits,
    persona: account.persona,
    accountId: account.id,
    mediaRoot: options.mediaRoot,
    usage: options.usage,
    usedFilenames,
    usageDays,
    randomCount: options.randomCount ?? options.aleatoriasCount,
    aleatoriasCount: options.aleatoriasCount ?? options.randomCount,
    now: options.now,
  });
}
