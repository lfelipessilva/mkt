import cron, { type ScheduledTask } from "node-cron";
import type { Pool } from "pg";
import { getPool } from "./shared/db/client.js";
import { runAutomationTick } from "./domain/automation/ticker.js";
import { pollPendingPostsJob } from "./domain/social/polling.js";
import { syncTikTokMetricsDailyJob } from "./domain/social/metricsSync.js";
import type { SocialPublisherProvider } from "./domain/social/types.js";

export interface CronConfig {
  automationSchedule?: string;
  schedule?: string;
  pollingSchedule?: string;
  metricsSchedule?: string;
  timezone?: string;
  pool?: Pool;
  socialPublisherProvider?: SocialPublisherProvider;
  runBootTick?: boolean;
}

export interface RunningCronTasks {
  automationTask: ScheduledTask;
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

export function startCron(options: CronConfig = {}): ScheduledTask & { tasks?: RunningCronTasks } {
  const automationSchedule =
    options.automationSchedule ||
    options.schedule ||
    process.env.AUTOMATION_CRON_SCHEDULE ||
    "* * * * *";
  const pollingSchedule =
    options.pollingSchedule ||
    process.env.POLLING_CRON_SCHEDULE ||
    "*/2 * * * *";
  const metricsSchedule =
    options.metricsSchedule ||
    process.env.METRICS_CRON_SCHEDULE ||
    "0 4 * * *";
  const timezone = options.timezone || process.env.TZ || "America/Sao_Paulo";
  const pool = options.pool || getPool();

  if (!cron.validate(automationSchedule)) {
    throw new Error(`AUTOMATION_CRON_SCHEDULE inválido: ${automationSchedule}`);
  }
  if (!cron.validate(pollingSchedule)) {
    throw new Error(`POLLING_CRON_SCHEDULE inválido: ${pollingSchedule}`);
  }
  if (!cron.validate(metricsSchedule)) {
    throw new Error(`METRICS_CRON_SCHEDULE inválido: ${metricsSchedule}`);
  }

  const automationTask = cron.schedule(
    automationSchedule,
    async () => {
      try {
        await runAutomationTick({ pool });
      } catch (e: any) {
        console.error("[cron:automation]", e.message);
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
    automationTask,
    pollingTask,
    metricsTask,
    stop: () => {
      automationTask.stop();
      pollingTask.stop();
      metricsTask.stop();
    },
  };

  const resultTask = automationTask as ScheduledTask & { tasks?: RunningCronTasks };
  resultTask.tasks = runningTasks;
  const originalStop = automationTask.stop.bind(automationTask);
  resultTask.stop = () => {
    originalStop();
    pollingTask.stop();
    metricsTask.stop();
  };

  // Boot calls recover + one tick
  if (options.runBootTick !== false) {
    runAutomationTick({ pool, recoverStaleRunning: true }).catch((err) => {
      console.error("[cron:boot]", err?.message || err);
    });
  }

  return resultTask;
}
