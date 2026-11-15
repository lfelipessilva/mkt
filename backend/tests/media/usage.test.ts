import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { replaceArchetypesForScope } from "../../src/domain/archetypes/store.js";
import {
  recordMediaUsage,
  recentlyUsedFilenames,
  upsertMediaAsset,
} from "../../src/domain/media/store.js";
import {
  available,
  getUsageDays,
  selectCarouselForAccount,
} from "../../src/pipeline/select.js";

const { Pool } = pg;

describe("Task 10: Usage in Postgres & rotation", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let tmpMediaDir: string;

  before(async () => {
    let connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      connectionString = container.getConnectionUri();
      process.env.DATABASE_URL = connectionString;
    }

    pool = new Pool({ connectionString });
    await runMigrations(pool);

    // Create temporary media root with files
    tmpMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-test-media-"));

    const dirs = [
      path.join(tmpMediaDir, "single_woman", "capas"),
      path.join(tmpMediaDir, "single_woman", "aleatorias"),
      path.join(tmpMediaDir, "shared", "aleatorias"),
      path.join(tmpMediaDir, "shared", "listo"),
    ];
    for (const d of dirs) {
      fs.mkdirSync(d, { recursive: true });
    }

    fs.writeFileSync(path.join(tmpMediaDir, "single_woman", "capas", "woman_capa_1.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaDir, "single_woman", "capas", "woman_capa_2.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaDir, "single_woman", "aleatorias", "woman_aleat_1.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaDir, "single_woman", "aleatorias", "woman_aleat_2.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaDir, "shared", "aleatorias", "shared_aleat_1.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaDir, "shared", "aleatorias", "shared_aleat_2.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaDir, "shared", "listo", "listo_1.png"), "dummy");
    fs.writeFileSync(path.join(tmpMediaDir, "shared", "listo", "listo_2.png"), "dummy");
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE media_usage, carousel_runs, media_assets, accounts CASCADE;");
  });

  after(async () => {
    await closePool();
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
    if (tmpMediaDir && fs.existsSync(tmpMediaDir)) {
      fs.rmSync(tmpMediaDir, { recursive: true, force: true });
    }
  });

  describe("Step 1: recordMediaUsage and recentlyUsedFilenames pool exclusion", () => {
    it("records media usage and excludes used filename from available() pool within window", async () => {
      // 1. Create account
      await upsertAccount(
        {
          id: "acc_woman_1",
          persona: "Mulher autônoma",
          role: "single_woman",
          enabled: true,
        },
        pool
      );

      // 2. Insert media assets in DB
      const asset1 = await upsertMediaAsset(
        {
          scope: "single_woman",
          category: "capas",
          storage_path: "media/single_woman/capas/woman_capa_1.jpg",
          filename: "woman_capa_1.jpg",
        },
        pool
      );

      const asset2 = await upsertMediaAsset(
        {
          scope: "single_woman",
          category: "capas",
          storage_path: "media/single_woman/capas/woman_capa_2.jpg",
          filename: "woman_capa_2.jpg",
        },
        pool
      );

      // 3. Create a carousel run
      const runRes = await pool.query(
        `INSERT INTO carousel_runs (id, account_id, account_role, archetype_title, legenda)
         VALUES (gen_random_uuid(), 'acc_woman_1', 'single_woman', 'Arquetipo 1', 'Legenda 1')
         RETURNING id`
      );
      const runId = runRes.rows[0].id;

      // 4. Record usage for asset1
      await recordMediaUsage(runId, [asset1.id], pool);

      // 5. Query recently used filenames for single_woman
      const usedFilenames = await recentlyUsedFilenames("single_woman", 7, pool);
      assert.ok(usedFilenames instanceof Set);
      assert.ok(usedFilenames.has("woman_capa_1.jpg"), "usedFilenames should have woman_capa_1.jpg");
      assert.ok(!usedFilenames.has("woman_capa_2.jpg"), "usedFilenames should not have woman_capa_2.jpg");

      // 6. Test available() pool exclusion
      const poolImages = [
        { filename: "woman_capa_1.jpg", path: "/path/to/woman_capa_1.jpg" },
        { filename: "woman_capa_2.jpg", path: "/path/to/woman_capa_2.jpg" },
      ];
      const availableImages = available(poolImages, usedFilenames, 1);
      assert.equal(availableImages.length, 1);
      assert.equal(availableImages[0].filename, "woman_capa_2.jpg");
    });

    it("respects window cutoff: excludes items outside usage window", async () => {
      await upsertAccount(
        {
          id: "acc_woman_2",
          persona: "Mulher autônoma",
          role: "single_woman",
          enabled: true,
        },
        pool
      );

      const assetRecent = await upsertMediaAsset(
        {
          scope: "single_woman",
          category: "capas",
          storage_path: "media/single_woman/capas/woman_capa_recent.jpg",
          filename: "woman_capa_recent.jpg",
        },
        pool
      );

      const assetOld = await upsertMediaAsset(
        {
          scope: "single_woman",
          category: "capas",
          storage_path: "media/single_woman/capas/woman_capa_old.jpg",
          filename: "woman_capa_old.jpg",
        },
        pool
      );

      const runRes = await pool.query(
        `INSERT INTO carousel_runs (id, account_id, account_role, archetype_title, legenda)
         VALUES (gen_random_uuid(), 'acc_woman_2', 'single_woman', 'Arquetipo 2', 'Legenda 2')
         RETURNING id`
      );
      const runId = runRes.rows[0].id;

      // Record recent usage (now)
      await recordMediaUsage(runId, [assetRecent.id], pool);

      // Record old usage (10 days ago)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await recordMediaUsage(runId, [assetOld.id], pool, tenDaysAgo);

      // Within 7 days window:
      const used7Days = await recentlyUsedFilenames("single_woman", 7, pool);
      assert.ok(used7Days.has("woman_capa_recent.jpg"));
      assert.ok(!used7Days.has("woman_capa_old.jpg"), "10 days old asset should not be in 7 days window");

      // Within 14 days window:
      const used14Days = await recentlyUsedFilenames("single_woman", 14, pool);
      assert.ok(used14Days.has("woman_capa_recent.jpg"));
      assert.ok(used14Days.has("woman_capa_old.jpg"), "10 days old asset should be in 14 days window");
    });

    it("isolates role scopes: usage in single_woman does not exclude role-specific media in single_man", async () => {
      await upsertAccount(
        {
          id: "acc_woman_3",
          persona: "Mulher autônoma",
          role: "single_woman",
          enabled: true,
        },
        pool
      );
      await upsertAccount(
        {
          id: "acc_man_3",
          persona: "Homem solteiro",
          role: "single_man",
          enabled: true,
        },
        pool
      );

      const assetWoman = await upsertMediaAsset(
        {
          scope: "single_woman",
          category: "capas",
          storage_path: "media/single_woman/capas/capa_w.jpg",
          filename: "capa_w.jpg",
        },
        pool
      );

      const runWoman = await pool.query(
        `INSERT INTO carousel_runs (id, account_id, account_role, archetype_title, legenda)
         VALUES (gen_random_uuid(), 'acc_woman_3', 'single_woman', 'Arquetipo W', 'Legenda W')
         RETURNING id`
      );
      await recordMediaUsage(runWoman.rows[0].id, [assetWoman.id], pool);

      const usedForMan = await recentlyUsedFilenames("single_man", 7, pool);
      assert.equal(usedForMan.has("capa_w.jpg"), false);
    });

    it("handles empty mediaIds and duplicates gracefully", async () => {
      await pool.query(`INSERT INTO accounts (id, persona, role) VALUES ('acc_temp', 'Temp', 'single_woman');`);
      const runRes = await pool.query(
        `INSERT INTO carousel_runs (id, account_id, account_role, archetype_title, legenda)
         VALUES (gen_random_uuid(), 'acc_temp', 'single_woman', 'Temp', 'Legenda')
         RETURNING id`
      );
      const runId = runRes.rows[0].id;

      // Empty array should not throw
      await recordMediaUsage(runId, [], pool);

      const asset = await upsertMediaAsset(
        {
          scope: "single_woman",
          category: "aleatorias",
          storage_path: "media/single_woman/aleatorias/temp.jpg",
          filename: "temp.jpg",
        },
        pool
      );

      // Duplicate ids in single call
      await recordMediaUsage(runId, [asset.id, asset.id], pool);
      const used = await recentlyUsedFilenames("single_woman", 7, pool);
      assert.ok(used.has("temp.jpg"));
    });
  });

  describe("Step 2: Wire usageDays = 7 from env default", () => {
    const originalEnv = process.env.USAGE_DAYS;

    after(() => {
      if (originalEnv !== undefined) {
        process.env.USAGE_DAYS = originalEnv;
      } else {
        delete process.env.USAGE_DAYS;
      }
    });

    it("defaults to 7 when USAGE_DAYS is not set", () => {
      delete process.env.USAGE_DAYS;
      assert.equal(getUsageDays(), 7);
    });

    it("reads USAGE_DAYS environment variable when configured", () => {
      process.env.USAGE_DAYS = "14";
      assert.equal(getUsageDays(), 14);

      process.env.USAGE_DAYS = "3";
      assert.equal(getUsageDays(), 3);
    });

    it("explicit parameter overrides environment variable", () => {
      process.env.USAGE_DAYS = "14";
      assert.equal(getUsageDays(5), 5);
      assert.equal(getUsageDays(1), 1);
    });

    it("integrates with selectCarouselForAccount: automatically fetches recentlyUsedFilenames from Postgres", async () => {
      delete process.env.USAGE_DAYS;

      await upsertAccount(
        {
          id: "acc_select_usage",
          persona: "Mulher autônoma",
          role: "single_woman",
          enabled: true,
        },
        pool
      );

      await replaceArchetypesForScope(
        "single_woman",
        [{ title: "Compre e economize", sort_order: 1 }],
        pool
      );

      // Asset 1
      const asset1 = await upsertMediaAsset(
        {
          scope: "single_woman",
          category: "capas",
          storage_path: "media/single_woman/capas/woman_capa_1.jpg",
          filename: "woman_capa_1.jpg",
        },
        pool
      );

      // Asset 2
      await upsertMediaAsset(
        {
          scope: "single_woman",
          category: "capas",
          storage_path: "media/single_woman/capas/woman_capa_2.jpg",
          filename: "woman_capa_2.jpg",
        },
        pool
      );

      // Record usage for woman_capa_1.jpg
      const runRes = await pool.query(
        `INSERT INTO carousel_runs (id, account_id, account_role, archetype_title, legenda)
         VALUES (gen_random_uuid(), 'acc_select_usage', 'single_woman', 'Arquetipo Prev', 'Legenda Prev')
         RETURNING id`
      );
      await recordMediaUsage(runRes.rows[0].id, [asset1.id], pool);

      // Run selection for account without passing explicit usage; it should load from DB!
      const selection = await selectCarouselForAccount("acc_select_usage", {
        pool,
        mediaRoot: tmpMediaDir,
        aleatoriasCount: 3,
      });

      // Capa slide should be woman_capa_2.jpg because woman_capa_1.jpg was recently used
      assert.equal(selection.slides[0].filename, "woman_capa_2.jpg");
    });
  });
});
