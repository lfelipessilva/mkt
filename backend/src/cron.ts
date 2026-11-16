import cron, { type ScheduledTask } from "node-cron";
import type { Pool } from "pg";
import { getPool } from "./shared/db/client.js";
import { withJobLock } from "./jobLock.js";
import { generateBatch } from "./domain/runs/generate.js";
import { pollPendingPostsJob } from "./domain/social/polling.js";
import { syncTikTokMetricsDailyJob } from "./domain/social/metricsSync.js";
import type { SocialPublisherProvider } from "./domain/social/types.js";

export interface CronConfig {
  schedule?: string;
  pollingSchedule?: string;
  metricsSchedule?: string;
  timezone?: string;
  pool?: Pool;
  socialPublisherProvider?: SocialPublisherProvider;
}

export interface RunningCronTasks {
  batchTask: ScheduledTask;
  pollingTask: ScheduledTask;
  metricsTask: ScheduledTask;
  stop: () => void;
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

export function startCron(options: CronConfig = {}): ScheduledTask & { tasks?: RunningCronTasks } {
  const schedule = options.schedule || process.env.CRON_SCHEDULE || "0 7,11,17 * * *";
  const pollingSchedule = options.pollingSchedule || process.env.POLLING_CRON_SCHEDULE || "*/2 * * * *";
  const metricsSchedule = options.metricsSchedule || process.env.METRICS_CRON_SCHEDULE || "0 4 * * *";
  const timezone = options.timezone || process.env.TZ || "America/Sao_Paulo";
  const pool = options.pool || getPool();

  if (!cron.validate(schedule)) {
    throw new Error(`CRON_SCHEDULE inválido: ${schedule}`);
  }
  if (!cron.validate(pollingSchedule)) {
    throw new Error(`POLLING_CRON_SCHEDULE inválido: ${pollingSchedule}`);
  }
  if (!cron.validate(metricsSchedule)) {
    throw new Error(`METRICS_CRON_SCHEDULE inválido: ${metricsSchedule}`);
  }

  const batchTask = cron.schedule(
    schedule,
    async () => {
      try {
        await runCronTick({ pool });
      } catch (e: any) {
        console.error("[cron:batch]", e.message);
      }
    },
    { timezone }
  );

  const pollingTask = cron.schedule(
    pollingSchedule,
    async () => {
      try {
        await pollPendingPostsJob(pool, options.socialPublisherProvider);
      } catch (e: any) {
        console.error("[cron:polling]", e.message);
      }
    },
    { timezone }
  );

  const metricsTask = cron.schedule(
    metricsSchedule,
    async () => {
      try {
        await syncTikTokMetricsDailyJob(pool, options.socialPublisherProvider);
      } catch (e: any) {
        console.error("[cron:metrics]", e.message);
      }
    },
    { timezone }
  );

  const runningTasks: RunningCronTasks = {
    batchTask,
    pollingTask,
    metricsTask,
    stop: () => {
      batchTask.stop();
      pollingTask.stop();
      metricsTask.stop();
    },
  };

  // Keep returning batchTask as ScheduledTask for backward compatibility, augmented with tasks
  const resultTask = batchTask as ScheduledTask & { tasks?: RunningCronTasks };
  resultTask.tasks = runningTasks;
  const originalStop = batchTask.stop.bind(batchTask);
  resultTask.stop = () => {
    originalStop();
    pollingTask.stop();
    metricsTask.stop();
    return resultTask;
  };

  return resultTask;
}
