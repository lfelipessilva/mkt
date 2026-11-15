import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanMediaToDb } from "../src/domain/media/store.js";
import { getMediaRoot } from "../src/domain/media/paths.js";
import { closePool, getPool } from "../src/shared/db/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

async function main() {
  const mediaRoot = getMediaRoot();
  console.log(`[media:scan] Scanning media root: ${mediaRoot}`);
  const pool = getPool();
  try {
    const count = await scanMediaToDb(mediaRoot, pool);
    console.log(`[media:scan] Completed: ${count} media assets scanned/upserted.`);
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error("[media:scan] Error:", err);
  process.exit(1);
});
