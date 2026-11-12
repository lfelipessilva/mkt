import { Bot } from "grammy";
import { config } from "./config.js";
import { getJobStatus, withJobLock } from "./jobLock.js";
import { runBatch, runOneMore } from "./pipeline/run.js";

function allowed(ctx) {
  if (!config.allowedUserIds.length) return true;
  return config.allowedUserIds.includes(ctx.from?.id);
}

function parseAccountArg(text) {
  const parts = (text || "").trim().split(/\s+/);
  return parts[1] || undefined;
}

export function createBot() {
  if (!config.telegramBotToken) return null;

  const bot = new Bot(config.telegramBotToken);

  bot.use(async (ctx, next) => {
    if (!allowed(ctx)) {
      await ctx.reply("sem permissão");
      return;
    }
    await next();
  });

  bot.command("status", async (ctx) => {
    const s = getJobStatus();
    await ctx.reply(
      `busy=${s.busy}\nstate=${s.state}\nat=${s.at || "-"}\ndetail=${s.detail || "-"}`,
    );
  });

  bot.command("gerar", async (ctx) => {
    const accountId = parseAccountArg(ctx.message?.text || "");
    await ctx.reply(accountId ? `gerando ${accountId}...` : "gerando turno (todas as contas)...");
    try {
      const result = await withJobLock(() =>
        runBatch({ accountId, api: bot.api, dryRun: false }),
      );
      await ctx.reply(`ok: ${result.summary}`);
    } catch (e) {
      await ctx.reply(`erro: ${e.message}`);
    }
  });

  bot.command("mais", async (ctx) => {
    const accountId = parseAccountArg(ctx.message?.text || "");
    await ctx.reply(accountId ? `gerando 1 extra pra ${accountId}...` : "gerando 1 extra...");
    try {
      const result = await withJobLock(() =>
        runOneMore({ accountId, api: bot.api, dryRun: false }),
      );
      await ctx.reply(`ok: ${result.summary}`);
    } catch (e) {
      await ctx.reply(`erro: ${e.message}`);
    }
  });

  return bot;
}
