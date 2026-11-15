import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Pool } from "pg";
import { AppError } from "../shared/errors.js";
import {
  AccountRoleSchema,
  type AccountRole,
} from "../domain/accounts/schemas.js";
import { getAccount } from "../domain/accounts/store.js";
import { loadEffectiveForAccount } from "../domain/content/effective.js";
import { getMediaRoot } from "../domain/media/paths.js";
import type { Archetype } from "../domain/archetypes/schemas.js";
import type { Bait } from "../domain/baits/schemas.js";

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
  mediaRoot?: string;
  persona?: string;
  accountId?: string;
  usage?: UsageData | null;
  usageDays?: number;
  aleatoriasCount?: number;
  now?: number;
}

export function resolveMediaForRole(mediaRoot: string = getMediaRoot(), role: AccountRole): MediaDirs {
  if (!AccountRoleSchema.safeParse(role).success) {
    throw new Error(`role inválido: ${role}`);
  }
  const root = getMediaRoot(mediaRoot);
  return {
    capas: join(root, role, "capas"),
    aleatoriasRole: join(root, role, "aleatorias"),
    aleatoriasShared: join(root, "shared", "aleatorias"),
    listo: join(root, "shared", "listo"),
  };
}

export function allMediaImageDirs(mediaRoot?: string): string[] {
  const root = getMediaRoot(mediaRoot);
  const dirs: string[] = [];
  for (const role of AccountRoleSchema.options) {
    dirs.push(join(root, role, "aleatorias"));
  }
  dirs.push(join(root, "shared", "aleatorias"));
  return dirs;
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

export function listImages(dir: string): MediaImage[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => IMAGE_RE.test(f))
    .map((f) => ({ filename: f, path: join(dir, f) }));
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

export function recentlyUsedFilenames(usage?: UsageData | null): Set<string> {
  return new Set((usage?.entries || []).map((e) => e.filename));
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

function available(pool: MediaImage[], used: Set<string>, need = 1): MediaImage[] {
  const free = pool.filter((img) => !used.has(img.filename));
  return free.length >= need ? free : pool;
}

function pickBait(baits: string[], usedBaits: Set<string>): string {
  const free = baits.filter((b) => !usedBaits.has(b));
  return pickRandom(free.length ? free : baits);
}

export function selectCarousel({
  mediaRoot,
  role,
  archetypes,
  baits = [],
  persona,
  accountId,
  usage,
  usageDays = 7,
  aleatoriasCount,
  now = Date.now(),
}: SelectCarouselInput): CarouselSelection {
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

  const pruned = pruneUsage(usage, usageDays, now);
  const used = recentlyUsedFilenames(pruned);
  const usedBaits = recentlyUsedBaits(pruned);

  const dirs = resolveMediaForRole(mediaRoot, role);
  const capas = listImages(dirs.capas);
  const aleatorias = unionImages(
    listImages(dirs.aleatoriasRole),
    listImages(dirs.aleatoriasShared)
  );
  const listos = listImages(dirs.listo);

  if (!capas.length || !listos.length || aleatorias.length < 3) {
    throw new Error(
      `mídia insuficiente (${role}): capas=${capas.length} aleatorias=${aleatorias.length} listo=${listos.length}`
    );
  }

  const nAleatorias = aleatoriasCount ?? (Math.random() < 0.5 ? 3 : 4);
  const count = Math.min(nAleatorias, aleatorias.length);

  const capa = pickRandom(available(capas, used));
  const listo = pickRandom(
    available(
      listos.filter((i) => i.filename !== capa.filename),
      used
    )
  );

  const pickedAleatorias: MediaImage[] = [];
  const usedCategories = new Set<string>();
  const aleatoriaPool = available(
    aleatorias.filter((i) => i.filename !== capa.filename && i.filename !== listo.filename),
    used,
    count
  );
  const shuffledAleatorias = shuffle(aleatoriaPool);

  for (const img of shuffledAleatorias) {
    if (pickedAleatorias.length >= count) break;
    const cat = categoryPrefix(img.filename);
    if (usedCategories.has(cat)) continue;
    usedCategories.add(cat);
    pickedAleatorias.push(img);
  }

  if (pickedAleatorias.length < count) {
    for (const img of shuffledAleatorias) {
      if (pickedAleatorias.length >= count) break;
      if (pickedAleatorias.includes(img)) continue;
      pickedAleatorias.push(img);
    }
  }

  if (pickedAleatorias.length < count) {
    throw new Error(`não deu pra sortear ${count} imagens aleatórias`);
  }

  const mid = shuffle([...pickedAleatorias]);
  const listoAt = mid.length - (mid.length > 1 && Math.random() < 0.5 ? 1 : 0);
  mid.splice(listoAt, 0, listo);

  const slides: SlideSelection[] = [capa, ...mid].map((img, i) => ({
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
    usageDays?: number;
    aleatoriasCount?: number;
    now?: number;
  } = {}
): Promise<CarouselSelection> {
  const account = await getAccount(accountId, options.pool);
  if (!account) {
    throw new AppError(`Account not found: ${accountId}`, 404, "not_found");
  }

  const effective = await loadEffectiveForAccount(accountId, options.pool, {
    activeOnly: true,
  });

  return selectCarousel({
    role: account.role,
    archetypes: effective.archetypes,
    baits: effective.baits,
    persona: account.persona,
    accountId: account.id,
    mediaRoot: options.mediaRoot,
    usage: options.usage,
    usageDays: options.usageDays,
    aleatoriasCount: options.aleatoriasCount,
    now: options.now,
  });
}
