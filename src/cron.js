import cron from "node-cron";
import { config } from "./config.js";
import { withJobLock } from "./jobLock.js";
import { runBatch } from "./pipeline/run.js";

export function startCron({ api, dryRun = false }) {
  if (!cron.validate(config.cronSchedule)) {
    throw new Error(`CRON_SCHEDULE inválido: ${config.cronSchedule}`);
  }

  return cron.schedule(
    config.cronSchedule,
    async () => {
      try {
        await withJobLock(() => runBatch({ api, dryRun }));
      } catch (e) {
        console.error("[cron]", e.message);
      }
    },
    { timezone: process.env.TZ || "America/Sao_Paulo" },
  );
}
