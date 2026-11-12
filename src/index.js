import { createBot } from "./bot.js";
import { config } from "./config.js";
import { startCron } from "./cron.js";
import { withJobLock } from "./jobLock.js";
import { runBatch } from "./pipeline/run.js";
import { createServer } from "./server.js";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const dryRun = args.has("--dry-run");

async function main() {
  const bot = createBot();
  const api = bot?.api;

  if (once) {
    const result = await withJobLock(() => runBatch({ api, dryRun }));
    console.log(result.summary);
    process.exit(0);
  }

  const { start, app } = createServer({ port: config.port });
  await start();
  console.log(`health on :${config.port}/health`);

  const shutdown = () => {
    app.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (bot) {
    startCron({ api: bot.api, dryRun: false });
    bot.start();
    console.log("bot + cron up");
  } else {
    console.warn("TELEGRAM_BOT_TOKEN ausente — só /health ativo");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
