import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { scanMediaToDb } from "./domain/media/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from backend directory or workspace root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

export const app = buildApp();

export async function start() {
  try {
    // Scan media into database on dev startup
    if (process.env.NODE_ENV !== "test" && process.env.NODE_ENV !== "production") {
      try {
        const scanned = await scanMediaToDb();
        console.log(`[media:scan] Initial dev scan synced ${scanned} assets to database`);
      } catch (scanErr) {
        console.warn("[media:scan] Initial dev scan skipped or failed:", scanErr);
      }
    }

    await app.listen({ port, host });
    console.log(`Server listening on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test") {
  start();
}
