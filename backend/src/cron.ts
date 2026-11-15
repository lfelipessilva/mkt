import cron, { type ScheduledTask } from "node-cron";
import type { Pool } from "pg";
import { getPool } from "./shared/db/client.js";
import { withJobLock } from "./jobLock.js";
import { generateBatch } from "./domain/runs/generate.js";

export interface CronConfig {
  schedule?: string;
  timezone?: string;
  pool?: Pool;
}

export async function isAutoDispatchEnabled(pool: Pool): Promise<boolean> {
  try {
    const res = await pool.query<{ value: any }>(
      `SELECT value FROM app_settings WHERE key = 'auto_dispatch_enabled' LIMIT 1`
    );
    if (!res.rows[0]) return false;
    const val = res.rows[0].value;
    if (typeof val === "boolean") return val;
    if (typeof val === "string") return val.toLowerCase() === "true";
    if (typeof val === "object" && val !== null && "enabled" in val) {
      return Boolean(val.enabled);
    }
    return Boolean(val);
  } catch (err) {
    console.error("[cron:isAutoDispatchEnabled] error querying app_settings:", err);
    return false;
  }
}

export interface RunCronTickOptions {
  pool?: Pool;
  mockCopy?: any;
  skipRender?: boolean;
}

export async function runCronTick(options: RunCronTickOptions = {}): Promise<{ ran: boolean; summary?: string }> {
  const pool = options.pool || getPool();
  const autoDispatch = await isAutoDispatchEnabled(pool);
  if (!autoDispatch) {
    console.log("[cron] auto_dispatch_enabled is false/unset; skipping scheduled runBatch");
    return { ran: false };
  }

  const result = await withJobLock(async () => {
    const batchRes = await generateBatch({
      pool,
      mockCopy: options.mockCopy,
      skipRender: options.skipRender,
    });
    return {
      summary: `${batchRes.runs.length} carrossel(is) gerado(s)`,
      batchRes,
    };
  });

  return { ran: true, summary: result.summary };
}

export function startCron(options: CronConfig = {}): ScheduledTask {
  const schedule = options.schedule || process.env.CRON_SCHEDULE || "0 7,11,17 * * *";
  const timezone = options.timezone || process.env.TZ || "America/Sao_Paulo";
  const pool = options.pool || getPool();

  if (!cron.validate(schedule)) {
    throw new Error(`CRON_SCHEDULE inválido: ${schedule}`);
  }

  return cron.schedule(
    schedule,
    async () => {
      try {
        await runCronTick({ pool });
      } catch (e: any) {
        console.error("[cron]", e.message);
      }
    },
    { timezone }
  );
}
