import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

export function listImages(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => IMAGE_RE.test(f))
    .map((f) => ({ filename: f, path: join(dir, f) }));
}

export function loadUsage(usagePath) {
  if (!existsSync(usagePath)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(usagePath, "utf8"));
  } catch {
    return { entries: [] };
  }
}

export function saveUsage(usagePath, usage) {
  mkdirSync(join(usagePath, ".."), { recursive: true });
  writeFileSync(usagePath, JSON.stringify(usage, null, 2));
}

export function pruneUsage(usage, days, now = Date.now()) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return {
    entries: (usage.entries || []).filter((e) => new Date(e.at).getTime() >= cutoff),
  };
}

export function recentlyUsedFilenames(usage) {
  return new Set((usage.entries || []).map((e) => e.filename));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function available(pool, used, need = 1) {
  const free = pool.filter((img) => !used.has(img.filename));
  return free.length >= need ? free : pool;
}

export function selectCarousel({
  mediaDirs,
  archetypes,
  persona,
  accountId,
  usage,
  usageDays = 7,
  aleatoriasCount,
  now = Date.now(),
}) {
  const pruned = pruneUsage(usage, usageDays, now);
  const used = recentlyUsedFilenames(pruned);

  const capas = listImages(mediaDirs.capas);
  const aleatorias = listImages(mediaDirs.aleatorias);
  const listos = listImages(mediaDirs.listo);

  if (!capas.length || !listos.length || aleatorias.length < 3) {
    throw new Error(
      `mídia insuficiente: capas=${capas.length} aleatorias=${aleatorias.length} listo=${listos.length}`,
    );
  }

  const nAleatorias = aleatoriasCount ?? (Math.random() < 0.5 ? 3 : 4);
  const count = Math.min(nAleatorias, aleatorias.length);

  const capa = pickRandom(available(capas, used));
  const listo = pickRandom(
    available(
      listos.filter((i) => i.filename !== capa.filename),
      used,
    ),
  );

  const pickedAleatorias = [];
  const usedCategories = new Set();
  const aleatoriaPool = available(
    aleatorias.filter((i) => i.filename !== capa.filename && i.filename !== listo.filename),
    used,
    count,
  );
  const shuffledAleatorias = shuffle(aleatoriaPool);
  for (const img of shuffledAleatorias) {
    if (pickedAleatorias.length >= count) break;
    const cat = categoryPrefix(img.filename);
    if (usedCategories.has(cat)) continue;
    usedCategories.add(cat);
    pickedAleatorias.push(img);
  }
  // shortcut: pool still mostly mercado/casa, fill if unique prefixes run out
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

  const mid = shuffle([...pickedAleatorias, listo]);
  const slides = [capa, ...mid].map((img, i) => ({
    numero: i + 1,
    filename: img.filename,
    path: img.path,
    isListo: img === listo || /listo/i.test(img.filename),
    isCapa: i === 0,
  }));

  const arquetipoTitulo = pickRandom(archetypes);

  return {
    accountId,
    persona,
    arquetipoTitulo,
    slides,
    usageUpdate: {
      entries: [
        ...pruned.entries,
        ...slides.map((s) => ({ filename: s.filename, at: new Date(now).toISOString() })),
      ],
    },
  };
}

export function recordUsage(usagePath, usageUpdate) {
  saveUsage(usagePath, usageUpdate);
}

export function filenameStem(filename) {
  return basename(filename).replace(IMAGE_RE, "");
}

export function categoryPrefix(filename) {
  const stem = filenameStem(filename);
  const i = stem.indexOf("_");
  return (i > 0 ? stem.slice(0, i) : stem).toLowerCase();
}
