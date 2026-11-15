import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { listAccounts } from "../../src/domain/accounts/store.js";
import { listArchetypes } from "../../src/domain/archetypes/store.js";
import { listBaits } from "../../src/domain/baits/store.js";
import { seedFromLegacy } from "../../scripts/seed-from-legacy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

describe("Task 14: Legacy seed CLI (seed-from-legacy)", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let tempFixtureDir: string;

  before(async () => {
    let connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      connectionString = container.getConnectionUri();
      process.env.DATABASE_URL = connectionString;
    }

    pool = new Pool({ connectionString });
    await runMigrations(pool);

    // Setup temporary fixture directory
    tempFixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "seed-test-fixture-"));

    const fixtureAccounts = {
      accounts: [
        {
          id: "rebeca.andrade.daily",
          mediaRole: "mulher",
          persona: "Mulher jovem que mora sozinha.",
          postsPerRun: 1,
        },
        {
          id: "camila.e.thiago.ap",
          mediaRole: "casal",
          persona: "Casal recém morando junto.",
          postsPerRun: 1,
        },
      ],
      disabledAccounts: [
        {
          id: "lucas.mendes.rotina",
          mediaRole: "homem",
          persona: "Homem prático morando sozinho.",
          postsPerRun: 1,
        },
        {
          id: "renata.sousa.daily",
          mediaRole: "casal",
          persona: "Casal prático com 7 anos juntos.",
          postsPerRun: 1,
        },
      ],
    };

    const fixtureArchetypes = {
      archetypesByAccount: {
        "rebeca.andrade.daily": [
          "rebeca archetype 1",
          "rebeca archetype 2",
        ],
        "lucas.mendes.rotina": [
          "lucas archetype 1",
        ],
        "camila.e.thiago.ap": [
          "couple shared title duplicate",
          "camila unique archetype",
        ],
        "renata.sousa.daily": [
          "couple shared title duplicate", // duplicate with camila
          "renata unique archetype",
        ],
      },
    };

    const fixtureBaits = {
      baits: [
        "o truque da toalha",
        "o silêncio de 11 minutos",
        "a regra do primeiro gole",
      ],
    };

    await fs.writeFile(
      path.join(tempFixtureDir, "accounts.json"),
      JSON.stringify(fixtureAccounts, null, 2),
      "utf-8"
    );
    await fs.writeFile(
      path.join(tempFixtureDir, "archetypes.json"),
      JSON.stringify(fixtureArchetypes, null, 2),
      "utf-8"
    );
    await fs.writeFile(
      path.join(tempFixtureDir, "baits.json"),
      JSON.stringify(fixtureBaits, null, 2),
      "utf-8"
    );
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE accounts, archetypes, baits CASCADE;");
  });

  after(async () => {
    if (tempFixtureDir) {
      await fs.rm(tempFixtureDir, { recursive: true, force: true }).catch(() => {});
    }
    await closePool();
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  describe("Step 1: Test seed creates 4 accounts and archetypes for each role used", () => {
    it("creates 4 accounts with exact role mappings and enabled status", async () => {
      const result = await seedFromLegacy({ configDir: tempFixtureDir, pool });

      assert.equal(result.accountsCount, 4);

      const accounts = await listAccounts(pool);
      assert.equal(accounts.length, 4);

      const byId = new Map(accounts.map((a) => [a.id, a]));

      // rebeca.andrade.daily → single_woman, enabled: true
      const rebeca = byId.get("rebeca.andrade.daily");
      assert.ok(rebeca, "rebeca account must exist");
      assert.equal(rebeca.role, "single_woman");
      assert.equal(rebeca.enabled, true);
      assert.equal(rebeca.persona, "Mulher jovem que mora sozinha.");

      // camila.e.thiago.ap → couple_women, enabled: true
      const camila = byId.get("camila.e.thiago.ap");
      assert.ok(camila, "camila account must exist");
      assert.equal(camila.role, "couple_women");
      assert.equal(camila.enabled, true);

      // lucas.mendes.rotina → single_man, enabled: false
      const lucas = byId.get("lucas.mendes.rotina");
      assert.ok(lucas, "lucas account must exist");
      assert.equal(lucas.role, "single_man");
      assert.equal(lucas.enabled, false);

      // renata.sousa.daily → couple_women, enabled: false
      const renata = byId.get("renata.sousa.daily");
      assert.ok(renata, "renata account must exist");
      assert.equal(renata.role, "couple_women");
      assert.equal(renata.enabled, false);
    });

    it("merges archetypes by role scope, dedupes titles, and keeps shared empty unless present", async () => {
      await seedFromLegacy({ configDir: tempFixtureDir, pool });

      // Check single_woman archetypes
      const womanArchetypes = await listArchetypes("single_woman", pool);
      assert.equal(womanArchetypes.length, 2);
      assert.deepEqual(
        womanArchetypes.map((a) => a.title).sort(),
        ["rebeca archetype 1", "rebeca archetype 2"].sort()
      );

      // Check single_man archetypes
      const manArchetypes = await listArchetypes("single_man", pool);
      assert.equal(manArchetypes.length, 1);
      assert.equal(manArchetypes[0].title, "lucas archetype 1");

      // Check couple_women archetypes (merged from camila + renata, with deduplication)
      const coupleArchetypes = await listArchetypes("couple_women", pool);
      // camila: "couple shared title duplicate", "camila unique archetype"
      // renata: "couple shared title duplicate" (dupe), "renata unique archetype"
      // Total unique titles: 3
      assert.equal(coupleArchetypes.length, 3);
      assert.deepEqual(
        coupleArchetypes.map((a) => a.title).sort(),
        [
          "camila unique archetype",
          "couple shared title duplicate",
          "renata unique archetype",
        ].sort()
      );

      // Shared archetypes should be empty because legacy fixture had no shared archetypes
      const sharedArchetypes = await listArchetypes("shared", pool);
      assert.equal(sharedArchetypes.length, 0);

      // couple_men was not used by any account, should have 0 archetypes
      const coupleMenArchetypes = await listArchetypes("couple_men", pool);
      assert.equal(coupleMenArchetypes.length, 0);
    });

    it("seeds baits into scope = shared", async () => {
      const result = await seedFromLegacy({ configDir: tempFixtureDir, pool });
      assert.equal(result.baitsCount, 3);

      const sharedBaits = await listBaits("shared", pool);
      assert.equal(sharedBaits.length, 3);
      assert.deepEqual(
        sharedBaits.map((b) => b.body).sort(),
        [
          "a regra do primeiro gole",
          "o silêncio de 11 minutos",
          "o truque da toalha",
        ].sort()
      );

      // No baits in other scopes
      const roleBaits = await listBaits("single_woman", pool);
      assert.equal(roleBaits.length, 0);
    });

    it("seeds shared archetypes if present in legacy", async () => {
      const dirWithShared = await fs.mkdtemp(path.join(os.tmpdir(), "seed-shared-test-"));
      try {
        await fs.writeFile(
          path.join(dirWithShared, "archetypes.json"),
          JSON.stringify({
            shared: ["shared archetype from legacy"],
            archetypesByAccount: {
              "rebeca.andrade.daily": ["rebeca title"],
            },
          }),
          "utf-8"
        );

        await seedFromLegacy({ configDir: dirWithShared, pool });

        const shared = await listArchetypes("shared", pool);
        assert.equal(shared.length, 1);
        assert.equal(shared[0].title, "shared archetype from legacy");
      } finally {
        await fs.rm(dirWithShared, { recursive: true, force: true }).catch(() => {});
      }
    });

    it("is idempotent: re-running does not produce duplicate rows or fail", async () => {
      await seedFromLegacy({ configDir: tempFixtureDir, pool });
      const firstAccounts = await listAccounts(pool);
      const firstArchetypes = await listArchetypes(undefined, pool);
      const firstBaits = await listBaits(undefined, pool);

      // Run again
      await seedFromLegacy({ configDir: tempFixtureDir, pool });
      const secondAccounts = await listAccounts(pool);
      const secondArchetypes = await listArchetypes(undefined, pool);
      const secondBaits = await listBaits(undefined, pool);

      assert.equal(secondAccounts.length, firstAccounts.length);
      assert.equal(secondArchetypes.length, firstArchetypes.length);
      assert.equal(secondBaits.length, firstBaits.length);
    });

    it("handles non-existent or empty config directory gracefully", async () => {
      const emptyDir = path.join(os.tmpdir(), "non-existent-seed-dir-" + Date.now());
      const result = await seedFromLegacy({ configDir: emptyDir, pool });
      assert.equal(result.accountsCount, 0);
      assert.equal(result.archetypesCount, 0);
      assert.equal(result.baitsCount, 0);
    });

    it("seeds successfully from actual repo config/ directory", async () => {
      const repoConfigDir = path.resolve(__dirname, "../../../config");
      const result = await seedFromLegacy({ configDir: repoConfigDir, pool });

      assert.equal(result.accountsCount, 4);

      // Verify accounts in DB
      const accounts = await listAccounts(pool);
      assert.equal(accounts.length, 4);
      const enabledAccounts = accounts.filter((a) => a.enabled);
      const disabledAccounts = accounts.filter((a) => !a.enabled);
      assert.equal(enabledAccounts.length, 2);
      assert.equal(disabledAccounts.length, 2);

      // Verify each role used has >= 1 archetype
      for (const role of ["single_woman", "single_man", "couple_women"] as const) {
        const archs = await listArchetypes(role, pool);
        assert.ok(
          archs.length >= 1,
          `Role ${role} should have >= 1 archetype, got ${archs.length}`
        );
      }

      // Verify baits count in shared scope
      const baits = await listBaits("shared", pool);
      assert.equal(baits.length, 26);
    });
  });
});
