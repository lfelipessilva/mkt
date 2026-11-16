import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSiloMediaToDb } from "../src/domain/media/store.js";
import { isSiloEnabled } from "../src/shared/storage/silo.js";
import { closePool, getPool } from "../src/shared/db/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

async function main() {
  const pool = getPool();
  try {
    if (!isSiloEnabled()) {
      console.warn("[media:scan] Silo is not enabled. Skipping scan.");
      return;
    }

    console.log("[media:scan] Scanning Silo media bucket (source of truth)...");
    const siloCount = await scanSiloMediaToDb(pool);
    console.log(`[media:scan] Silo: ${siloCount} media assets scanned/upserted.`);
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error("[media:scan] Error:", err);
  process.exit(1);
});
