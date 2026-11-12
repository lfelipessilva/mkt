import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(root, ".env") });

function loadJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

const accountsFile = loadJson("config/accounts.json");
const archetypesFile = loadJson("config/archetypes.json");
const baitsFile = loadJson("config/baits.json");

export const config = {
  root,
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  allowedUserIds: (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
  cronSchedule: process.env.CRON_SCHEDULE || "0 7,11,17 * * *",
  port: Number(process.env.PORT || 3000),
  accounts: accountsFile.accounts,
  archetypesByAccount: archetypesFile.archetypesByAccount || {},
  baits: baitsFile.baits,
  mediaRoot: join(root, "media"),
  usagePath: join(root, "data/usage.json"),
  outputDir: join(root, "output"),
  usageDays: 7,
};

export function getAccount(id) {
  return config.accounts.find((a) => a.id === id);
}
