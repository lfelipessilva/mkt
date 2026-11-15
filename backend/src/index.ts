import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from backend directory or workspace root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

export const app = buildApp();

export async function start() {
  try {
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
