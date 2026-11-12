import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, getAccount } from "../config.js";
import { generateCarouselCopy } from "./gemini.js";
import { renderCarousel } from "./render.js";
import {
  loadUsage,
  recordUsage,
  selectCarousel,
} from "./select.js";
import { sendCarouselAlbum } from "./telegram.js";

function dayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function generateOne({ account, dryRun, api, postIndex }) {
  const usage = loadUsage(config.usagePath);
  const selection = selectCarousel({
    mediaDirs: config.media,
    archetypes: config.archetypes,
    persona: account.persona,
    accountId: account.id,
    usage,
    usageDays: config.usageDays,
  });

  const copy = await generateCarouselCopy({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    persona: selection.persona,
    arquetipoTitulo: selection.arquetipoTitulo,
    slides: selection.slides,
  });

  const textsByNumero = new Map(
    copy.slides.map((s) => [s.numero, s.texto]),
  );

  const outDir = join(
    config.outputDir,
    dayStamp(),
    account.id,
    `post_${String(postIndex).padStart(2, "0")}`,
  );
  mkdirSync(outDir, { recursive: true });

  const imagePaths = await renderCarousel({
    slides: selection.slides,
    textsByNumero,
    outDir,
  });

  writeFileSync(
    join(outDir, "meta.json"),
    JSON.stringify({ selection: { ...selection, usageUpdate: undefined }, copy }, null, 2),
  );

  recordUsage(config.usagePath, selection.usageUpdate);

  if (!dryRun) {
    if (!api || !config.telegramChatId) {
      throw new Error("Telegram não configurado (token/chatId)");
    }
    await sendCarouselAlbum({
      api,
      chatId: config.telegramChatId,
      accountId: account.id,
      imagePaths,
      legenda: copy.legenda_tiktok,
    });
  }

  return { accountId: account.id, outDir, imagePaths, legenda: copy.legenda_tiktok };
}

export async function runBatch({ accountId, count, dryRun = false, api } = {}) {
  const accounts = accountId
    ? [getAccount(accountId)].filter(Boolean)
    : config.accounts;

  if (!accounts.length) {
    throw new Error(accountId ? `conta desconhecida: ${accountId}` : "nenhuma conta no config");
  }

  const results = [];
  for (const account of accounts) {
    const n = count ?? account.postsPerDay ?? 3;
    for (let i = 1; i <= n; i++) {
      results.push(await generateOne({ account, dryRun, api, postIndex: i }));
    }
  }

  return {
    results,
    summary: `${results.length} carrossel(is) gerado(s)`,
  };
}

export async function runOneMore({ accountId, dryRun = false, api } = {}) {
  const account = accountId
    ? getAccount(accountId)
    : config.accounts[Math.floor(Math.random() * config.accounts.length)];

  if (!account) throw new Error(accountId ? `conta desconhecida: ${accountId}` : "nenhuma conta");

  const stamp = Date.now();
  const result = await generateOne({
    account,
    dryRun,
    api,
    postIndex: stamp,
  });

  return {
    results: [result],
    summary: `1 extra pra ${account.id}`,
  };
}
