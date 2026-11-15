import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { Pool } from "pg";
import { getPool, closePool } from "../src/shared/db/client.js";
import { upsertAccount } from "../src/domain/accounts/store.js";
import { replaceArchetypesForScope } from "../src/domain/archetypes/store.js";
import { replaceBaitsForScope } from "../src/domain/baits/store.js";
import type { AccountRole } from "../src/domain/accounts/schemas.js";
import type {
  ContentScope,
  ArchetypeItemInput,
} from "../src/domain/archetypes/schemas.js";
import type { BaitItemInput } from "../src/domain/baits/schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

export const ACCOUNT_ROLE_MAP: Record<string, AccountRole> = {
  "rebeca.andrade.daily": "single_woman",
  "lucas.mendes.rotina": "single_man",
  "renata.sousa.daily": "couple_women",
  "camila.e.thiago.ap": "couple_women",
};

export function mapAccountRole(account: {
  id: string;
  mediaRole?: string;
  role?: string;
}): AccountRole {
  if (ACCOUNT_ROLE_MAP[account.id]) {
    return ACCOUNT_ROLE_MAP[account.id];
  }
  if (
    account.role &&
    ["single_man", "single_woman", "couple_men", "couple_women"].includes(
      account.role
    )
  ) {
    return account.role as AccountRole;
  }
  if (account.mediaRole === "mulher") return "single_woman";
  if (account.mediaRole === "homem") return "single_man";
  if (account.mediaRole === "casal") return "couple_women";
  return "single_woman";
}

export interface SeedOptions {
  configDir?: string;
  pool?: Pool;
}

export interface SeedResult {
  accountsCount: number;
  archetypesCount: number;
  baitsCount: number;
  rolesSeeded: string[];
}

interface LegacyAccountItem {
  id: string;
  mediaRole?: string;
  role?: string;
  persona?: string;
  postsPerRun?: number;
  name?: string;
  displayName?: string;
  display_name?: string;
  tiktok_open_id?: string | null;
}

interface LegacyAccountsJson {
  accounts?: LegacyAccountItem[];
  disabledAccounts?: LegacyAccountItem[];
}

interface LegacyArchetypesJson {
  archetypesByAccount?: Record<
    string,
    Array<string | { title: string; sort_order?: number; active?: boolean }>
  >;
  shared?: Array<string | { title: string; sort_order?: number; active?: boolean }>;
  archetypesByScope?: Record<
    string,
    Array<string | { title: string; sort_order?: number; active?: boolean }>
  >;
}

interface LegacyBaitsJson {
  baits?: Array<string | { body: string; sort_order?: number; active?: boolean }>;
  baitsByScope?: Record<
    string,
    Array<string | { body: string; sort_order?: number; active?: boolean }>
  >;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function seedFromLegacy(options: SeedOptions = {}): Promise<SeedResult> {
  const p = options.pool || getPool();
  const configDir =
    options.configDir ||
    process.env.CONFIG_DIR ||
    path.resolve(__dirname, "../../config");

  const result: SeedResult = {
    accountsCount: 0,
    archetypesCount: 0,
    baitsCount: 0,
    rolesSeeded: [],
  };

  if (!(await dirExists(configDir))) {
    console.log(`[db:seed] Config directory not found at ${configDir}. Nothing to seed.`);
    return result;
  }

  // 1. Seed Accounts
  const accountsFile = path.join(configDir, "accounts.json");
  const accountRoleById = new Map<string, AccountRole>();

  if (await fileExists(accountsFile)) {
    const rawContent = await fs.readFile(accountsFile, "utf-8");
    const accountsData: LegacyAccountsJson = JSON.parse(rawContent);

    const enabledList = accountsData.accounts || [];
    const disabledList = accountsData.disabledAccounts || [];

    for (const acc of enabledList) {
      const role = mapAccountRole(acc);
      accountRoleById.set(acc.id, role);
      await upsertAccount(
        {
          id: acc.id,
          display_name: acc.display_name ?? acc.displayName ?? acc.name ?? null,
          persona: acc.persona || "",
          role,
          enabled: true,
          tiktok_open_id: acc.tiktok_open_id ?? null,
        },
        p
      );
      result.accountsCount++;
    }

    for (const acc of disabledList) {
      const role = mapAccountRole(acc);
      accountRoleById.set(acc.id, role);
      await upsertAccount(
        {
          id: acc.id,
          display_name: acc.display_name ?? acc.displayName ?? acc.name ?? null,
          persona: acc.persona || "",
          role,
          enabled: false,
          tiktok_open_id: acc.tiktok_open_id ?? null,
        },
        p
      );
      result.accountsCount++;
    }
  }

  // 2. Seed Archetypes
  const archetypesFile = path.join(configDir, "archetypes.json");
  if (await fileExists(archetypesFile)) {
    const rawContent = await fs.readFile(archetypesFile, "utf-8");
    const archetypesData: LegacyArchetypesJson = JSON.parse(rawContent);

    const archetypesByScope: Record<ContentScope, Array<string | { title: string; sort_order?: number; active?: boolean }>> = {
      shared: [],
      single_man: [],
      single_woman: [],
      couple_men: [],
      couple_women: [],
    };

    let hasSharedInLegacy = false;

    // Check if shared archetypes are explicitly present in legacy
    if (Array.isArray(archetypesData.shared)) {
      archetypesByScope.shared.push(...archetypesData.shared);
      hasSharedInLegacy = true;
    }
    if (archetypesData.archetypesByScope?.shared) {
      archetypesByScope.shared.push(...archetypesData.archetypesByScope.shared);
      hasSharedInLegacy = true;
    }

    // Merge archetypes by account into corresponding role scope
    if (archetypesData.archetypesByAccount) {
      for (const [accountId, titles] of Object.entries(archetypesData.archetypesByAccount)) {
        const role =
          accountRoleById.get(accountId) ||
          ACCOUNT_ROLE_MAP[accountId] ||
          mapAccountRole({ id: accountId });

        if (Array.isArray(titles)) {
          archetypesByScope[role].push(...titles);
        }
      }
    }

    // Also support any direct scope definitions if present
    if (archetypesData.archetypesByScope) {
      for (const [scopeKey, items] of Object.entries(archetypesData.archetypesByScope)) {
        if (scopeKey !== "shared" && scopeKey in archetypesByScope) {
          archetypesByScope[scopeKey as ContentScope].push(...items);
        }
      }
    }

    // Dedupe titles and insert per scope
    const scopesToSeed: ContentScope[] = [
      "single_man",
      "single_woman",
      "couple_men",
      "couple_women",
    ];

    if (hasSharedInLegacy) {
      scopesToSeed.push("shared");
    }

    for (const scope of scopesToSeed) {
      const rawList = archetypesByScope[scope];
      if (rawList.length === 0 && scope !== "shared") {
        continue;
      }

      const seen = new Set<string>();
      const deduped: ArchetypeItemInput[] = [];

      for (const item of rawList) {
        const rawTitle = typeof item === "string" ? item : item.title;
        const title = (rawTitle || "").trim();
        if (!title) continue;

        const key = title.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push({
            title,
            sort_order: deduped.length,
            active:
              typeof item === "object" && item.active !== undefined
                ? item.active
                : true,
          });
        }
      }

      if (deduped.length > 0 || (scope === "shared" && hasSharedInLegacy)) {
        await replaceArchetypesForScope(scope, deduped, p);
        result.archetypesCount += deduped.length;
        if (!result.rolesSeeded.includes(scope)) {
          result.rolesSeeded.push(scope);
        }
      }
    }
  }

  // 3. Seed Baits (scope = shared)
  const baitsFile = path.join(configDir, "baits.json");
  if (await fileExists(baitsFile)) {
    const rawContent = await fs.readFile(baitsFile, "utf-8");
    const rawData = JSON.parse(rawContent);

    const baitsData: LegacyBaitsJson = Array.isArray(rawData)
      ? { baits: rawData }
      : rawData;

    const rawBaits =
      baitsData.baits || baitsData.baitsByScope?.shared || [];

    const seenBaits = new Set<string>();
    const dedupedBaits: BaitItemInput[] = [];

    for (const item of rawBaits) {
      const rawBody = typeof item === "string" ? item : item.body;
      const body = (rawBody || "").trim();
      if (!body) continue;

      const key = body.toLowerCase();
      if (!seenBaits.has(key)) {
        seenBaits.add(key);
        dedupedBaits.push({
          body,
          sort_order: dedupedBaits.length,
          active:
            typeof item === "object" && item.active !== undefined
              ? item.active
              : true,
        });
      }
    }

    if (dedupedBaits.length > 0) {
      await replaceBaitsForScope("shared", dedupedBaits, p);
      result.baitsCount = dedupedBaits.length;
    }
  }

  return result;
}

// CLI entrypoint
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  (async () => {
    try {
      console.log("[db:seed] Seeding database from legacy config...");
      const result = await seedFromLegacy();
      console.log(
        `[db:seed] Completed successfully: ${result.accountsCount} accounts, ${result.archetypesCount} archetypes, ${result.baitsCount} baits.`
      );
      await closePool();
      process.exit(0);
    } catch (err) {
      console.error("[db:seed] Seed failed:", err);
      await closePool().catch(() => {});
      process.exit(1);
    }
  })();
}
