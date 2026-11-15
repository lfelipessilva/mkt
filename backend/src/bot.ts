import { Bot, type Context } from "grammy";
import { getJobStatus, withJobLock } from "./jobLock.js";
import { generateBatch } from "./domain/runs/generate.js";
import { getPool } from "./shared/db/client.js";

export interface BotConfig {
  token?: string;
  allowedUserIds?: number[];
  pool?: any;
}

function getAllowedUserIds(): number[] {
  const raw = process.env.TELEGRAM_ALLOWED_USER_IDS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

function isAllowed(ctx: Context, allowedIds: number[]): boolean {
  if (!allowedIds.length) return true;
  const userId = ctx.from?.id;
  return userId !== undefined && allowedIds.includes(userId);
}

function parseAccountArg(text?: string): string | undefined {
  const parts = (text || "").trim().split(/\s+/);
  return parts[1] || undefined;
}

export function createBot(options: BotConfig = {}): Bot | null {
  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const allowedUserIds = options.allowedUserIds ?? getAllowedUserIds();
  const pool = options.pool || getPool();

  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    if (!isAllowed(ctx, allowedUserIds)) {
      await ctx.reply("sem permissão");
      return;
    }
    await next();
  });

  bot.command("status", async (ctx) => {
    const s = getJobStatus();
    await ctx.reply(
      `busy=${s.busy}\nstate=${s.state}\nat=${s.at || "-"}\ndetail=${s.detail || "-"}`
    );
  });

  bot.command("gerar", async (ctx) => {
    const accountId = parseAccountArg(ctx.message?.text);
    await ctx.reply(
      accountId ? `gerando ${accountId}...` : "gerando turno (todas as contas)..."
    );
    try {
      const result = await withJobLock(async () => {
        const batchRes = await generateBatch({
          accountIds: accountId ? [accountId] : undefined,
          pool,
        });
        return {
          summary: `${batchRes.runs.length} carrossel(is) gerado(s)`,
          batchRes,
        };
      });
      await ctx.reply(`ok: ${result.summary}`);
    } catch (e: any) {
      await ctx.reply(`erro: ${e.message}`);
    }
  });

  bot.command("mais", async (ctx) => {
    const accountId = parseAccountArg(ctx.message?.text);
    await ctx.reply(
      accountId ? `gerando 1 extra pra ${accountId}...` : "gerando 1 extra..."
    );
    try {
      const result = await withJobLock(async () => {
        let targetAccountId = accountId;
        if (!targetAccountId) {
          // Pick one enabled account randomly or the first
          const res = await pool.query(
            `SELECT id FROM accounts WHERE enabled = true ORDER BY RANDOM() LIMIT 1`
          );
          if (!res.rows[0]) {
            throw new Error("nenhuma conta habilitada encontrada");
          }
          targetAccountId = res.rows[0].id;
        }
        const batchRes = await generateBatch({
          accountIds: [targetAccountId!],
          pool,
        });
        return {
          summary: `1 extra pra ${targetAccountId}`,
          batchRes,
        };
      });
      await ctx.reply(`ok: ${result.summary}`);
    } catch (e: any) {
      await ctx.reply(`erro: ${e.message}`);
    }
  });

  return bot;
}
