import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { scanSiloMediaToDb } from "./domain/media/store.js";
import { isSiloEnabled } from "./shared/storage/silo.js";
import { createBot } from "./bot.js";
import { startCron } from "./cron.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from backend directory or workspace root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

export const app = buildApp();

export async function start() {
  try {
    // Scan media into database on dev startup if Silo enabled
    if (process.env.NODE_ENV !== "test" && process.env.NODE_ENV !== "production") {
      try {
        if (isSiloEnabled()) {
          const scanned = await scanSiloMediaToDb();
          console.log(`[media:scan] Initial dev scan synced ${scanned} assets to database`);
        }
      } catch (scanErr) {
        console.warn("[media:scan] Initial dev scan skipped or failed:", scanErr);
      }
    }

    await app.listen({ port, host });
    console.log(`Server listening on ${host}:${port}`);

    // Start Telegram bot and Cron schedule if configured and not in test
    if (process.env.NODE_ENV !== "test") {
      try {
        const bot = createBot();
        if (bot) {
          bot.start().catch((botErr) => {
            console.error("[telegram:bot] Bot polling error:", botErr);
          });
          console.log("[telegram:bot] Telegram bot started");
        } else {
          console.log("[telegram:bot] TELEGRAM_BOT_TOKEN not provided, bot skipped");
        }
      } catch (botInitErr) {
        console.error("[telegram:bot] Failed to initialize bot:", botInitErr);
      }

      try {
        startCron();
        console.log("[cron] Scheduled cron job started");
      } catch (cronErr: any) {
        console.warn("[cron] Cron not started:", cronErr.message);
      }
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test") {
  start();
}
