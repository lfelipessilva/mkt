import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { isAppError } from "../../src/shared/errors.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { replaceArchetypesForScope } from "../../src/domain/archetypes/store.js";
import { replaceBaitsForScope } from "../../src/domain/baits/store.js";
import type { Archetype } from "../../src/domain/archetypes/schemas.js";
import type { Bait } from "../../src/domain/baits/schemas.js";
import {
  mergeArchetypes,
  mergeBaits,
  scopesForRole,
  loadEffectiveForAccount,
} from "../../src/domain/content/effective.js";

const { Pool } = pg;

describe("effective content merge (dedupe)", { timeout: 60000 }, () => {
  describe("Step 1: mergeArchetypes", () => {
    it("Test duplicate title in shared and role -> single row, source role", () => {
      const sharedRows: Archetype[] = [
        {
          id: "shared-1",
          scope: "shared",
          title: "Romance Real",
          sort_order: 1,
          active: true,
        },
        {
          id: "shared-2",
          scope: "shared",
          title: "Dicas Gerais",
          sort_order: 2,
          active: true,
        },
      ];

      const roleRows: Archetype[] = [
        {
          id: "role-1",
          scope: "couple_men",
          title: "Romance Real",
          sort_order: 0,
          active: true,
        },
        {
          id: "role-2",
          scope: "couple_men",
          title: "Aventuras a Dois",
          sort_order: 1,
          active: true,
        },
      ];

      const merged = mergeArchetypes(sharedRows, roleRows);

      // Total count should be 3: "Dicas Gerais" (shared), "Romance Real" (role), "Aventuras a Dois" (role)
      assert.equal(merged.length, 3);

      const romanceItem = merged.find(
        (a) => a.title.trim().toLowerCase() === "romance real"
      );
      assert.ok(romanceItem, "Romance Real should exist in merged output");
      assert.equal(romanceItem.id, "role-1", "Role item should win over shared item");
      assert.equal(romanceItem.scope, "couple_men", "Scope should be role's scope");
      assert.equal(romanceItem.sort_order, 0);

      // Verify other items are present
      assert.ok(merged.some((a) => a.id === "shared-2"));
      assert.ok(merged.some((a) => a.id === "role-2"));
    });

    it("dedupes titles with whitespace and case variations (role wins)", () => {
      const sharedRows: Archetype[] = [
        {
          id: "shared-1",
          scope: "shared",
          title: "Vida Saudável",
          sort_order: 0,
          active: true,
        },
      ];

      const roleRows: Archetype[] = [
        {
          id: "role-1",
          scope: "single_woman",
          title: "  vida saudável  ",
          sort_order: 0,
          active: true,
        },
      ];

      const merged = mergeArchetypes(sharedRows, roleRows);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].id, "role-1");
      assert.equal(merged[0].scope, "single_woman");
    });

    it("handles empty arrays cleanly", () => {
      const sharedRows: Archetype[] = [
        {
          id: "shared-1",
          scope: "shared",
          title: "Compartilhado",
          sort_order: 0,
          active: true,
        },
      ];

      assert.deepEqual(mergeArchetypes([], []), []);
      assert.equal(mergeArchetypes(sharedRows, []).length, 1);
      assert.equal(mergeArchetypes([], sharedRows).length, 1);
    });
  });

  describe("Step 2: mergeBaits", () => {
    it("Test duplicate bait body with different casing -> one row", () => {
      const sharedRows: Bait[] = [
        {
          id: "bait-s1",
          scope: "shared",
          body: "VOCÊ NÃO VAI ACREDITAR",
          sort_order: 1,
          active: true,
        },
        {
          id: "bait-s2",
          scope: "shared",
          body: "Segredo revelado",
          sort_order: 2,
          active: true,
        },
      ];

      const roleRows: Bait[] = [
        {
          id: "bait-r1",
          scope: "couple_women",
          body: "você não vai acreditar",
          sort_order: 0,
          active: true,
        },
        {
          id: "bait-r2",
          scope: "couple_women",
          body: "Para casais apaixonados",
          sort_order: 1,
          active: true,
        },
      ];

      const merged = mergeBaits(sharedRows, roleRows);

      // Total count: 3 ("Segredo revelado", "você não vai acreditar" (role), "Para casais apaixonados")
      assert.equal(merged.length, 3);

      const dup = merged.find(
        (b) => b.body.trim().toLowerCase() === "você não vai acreditar"
      );
      assert.ok(dup, "Duplicate bait should exist in merged output");
      assert.equal(dup.id, "bait-r1", "Role bait wins");
      assert.equal(dup.scope, "couple_women");
      assert.equal(dup.body, "você não vai acreditar");

      assert.ok(merged.some((b) => b.id === "bait-s2"));
      assert.ok(merged.some((b) => b.id === "bait-r2"));
    });

    it("dedupes bait body with leading/trailing whitespace", () => {
      const sharedRows: Bait[] = [
        {
          id: "b1",
          scope: "shared",
          body: "Descubra agora",
          sort_order: 0,
          active: true,
        },
      ];

      const roleRows: Bait[] = [
        {
          id: "b2",
          scope: "single_man",
          body: "   descubra agora   \n",
          sort_order: 0,
          active: true,
        },
      ];

      const merged = mergeBaits(sharedRows, roleRows);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].id, "b2");
      assert.equal(merged[0].scope, "single_man");
    });
  });

  describe("scopesForRole helper", () => {
    it("returns [shared, role] for any valid account role", () => {
      assert.deepEqual(scopesForRole("single_man"), ["shared", "single_man"]);
      assert.deepEqual(scopesForRole("single_woman"), ["shared", "single_woman"]);
      assert.deepEqual(scopesForRole("couple_men"), ["shared", "couple_men"]);
      assert.deepEqual(scopesForRole("couple_women"), ["shared", "couple_women"]);
    });
  });

  describe("Step 3: loadEffectiveForAccount DB loader", () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: pg.Pool;

    before(async () => {
      let connectionString = process.env.DATABASE_URL;

      if (!connectionString) {
        container = await new PostgreSqlContainer("postgres:16-alpine").start();
        connectionString = container.getConnectionUri();
        process.env.DATABASE_URL = connectionString;
      }

      pool = new Pool({ connectionString });
      await runMigrations(pool);
    });

    beforeEach(async () => {
      await pool.query("TRUNCATE TABLE accounts, archetypes, baits CASCADE;");
    });

    after(async () => {
      await closePool();
      if (pool) {
        await pool.end();
      }
      if (container) {
        await container.stop();
      }
    });

    it("throws 404 AppError if account is not found", async () => {
      await assert.rejects(
        async () => {
          await loadEffectiveForAccount("nonexistent-acc", pool);
        },
        (err: unknown) => {
          assert.ok(isAppError(err));
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, "not_found");
          return true;
        }
      );
    });

    it("loads merged effective archetypes and baits for account with role winning", async () => {
      // 1. Create account with role 'single_woman'
      await upsertAccount(
        {
          id: "acc_sw_1",
          role: "single_woman",
          persona: "Mulher independente",
        },
        pool
      );

      // 2. Insert archetypes:
      // shared: "Finanças" (order 1), "Amor Próprio" (order 2)
      // single_woman: "Amor Próprio" (order 0 - override), "Carreira Feminina" (order 1)
      // single_man: "Carreira Masculina" (should NOT be included)
      await replaceArchetypesForScope(
        "shared",
        [
          { title: "Finanças", sort_order: 1, active: true },
          { title: "Amor Próprio", sort_order: 2, active: true },
        ],
        pool
      );

      await replaceArchetypesForScope(
        "single_woman",
        [
          { title: "Amor Próprio", sort_order: 0, active: true },
          { title: "Carreira Feminina", sort_order: 1, active: true },
        ],
        pool
      );

      await replaceArchetypesForScope(
        "single_man",
        [{ title: "Carreira Masculina", sort_order: 1, active: true }],
        pool
      );

      // 3. Insert baits:
      // shared: "Confira Essa Dica" (order 1), "Dica Exclusiva" (order 2)
      // single_woman: "confira essa dica" (different case, order 0), "Mulheres que inspiram" (order 1)
      // couple_men: "Homens apaixonados" (should NOT be included)
      await replaceBaitsForScope(
        "shared",
        [
          { body: "Confira Essa Dica", sort_order: 1, active: true },
          { body: "Dica Exclusiva", sort_order: 2, active: true },
        ],
        pool
      );

      await replaceBaitsForScope(
        "single_woman",
        [
          { body: "confira essa dica", sort_order: 0, active: true },
          { body: "Mulheres que inspiram", sort_order: 1, active: true },
        ],
        pool
      );

      await replaceBaitsForScope(
        "couple_men",
        [{ body: "Homens apaixonados", sort_order: 1, active: true }],
        pool
      );

      // 4. Load effective content
      const effective = await loadEffectiveForAccount("acc_sw_1", pool);

      assert.equal(effective.role, "single_woman");

      // Check archetypes
      assert.equal(effective.archetypes.length, 3);
      const amorProprio = effective.archetypes.find(
        (a) => a.title.toLowerCase() === "amor próprio"
      );
      assert.ok(amorProprio);
      assert.equal(amorProprio.scope, "single_woman", "Role archetype must win over shared");
      assert.equal(amorProprio.sort_order, 0);

      assert.ok(effective.archetypes.some((a) => a.title === "Finanças" && a.scope === "shared"));
      assert.ok(
        effective.archetypes.some((a) => a.title === "Carreira Feminina" && a.scope === "single_woman")
      );
      assert.ok(
        !effective.archetypes.some((a) => a.title === "Carreira Masculina"),
        "Other roles' archetypes must not be included"
      );

      // Check baits
      assert.equal(effective.baits.length, 3);
      const confiraBait = effective.baits.find(
        (b) => b.body.trim().toLowerCase() === "confira essa dica"
      );
      assert.ok(confiraBait);
      assert.equal(confiraBait.scope, "single_woman", "Role bait must win over shared");
      assert.equal(confiraBait.body, "confira essa dica");

      assert.ok(effective.baits.some((b) => b.body === "Dica Exclusiva" && b.scope === "shared"));
      assert.ok(
        effective.baits.some((b) => b.body === "Mulheres que inspiram" && b.scope === "single_woman")
      );
      assert.ok(
        !effective.baits.some((b) => b.body === "Homens apaixonados"),
        "Other roles' baits must not be included"
      );
    });

    it("filters out inactive rows by default, and includes them when activeOnly: false", async () => {
      await upsertAccount(
        {
          id: "acc_cm_1",
          role: "couple_men",
          persona: "Casal unido",
        },
        pool
      );

      await replaceArchetypesForScope(
        "shared",
        [
          { title: "Ativo Shared", sort_order: 1, active: true },
          { title: "Inativo Shared", sort_order: 2, active: false },
        ],
        pool
      );

      await replaceArchetypesForScope(
        "couple_men",
        [
          { title: "Ativo Role", sort_order: 1, active: true },
          { title: "Inativo Role", sort_order: 2, active: false },
        ],
        pool
      );

      await replaceBaitsForScope(
        "shared",
        [
          { body: "Bait Ativo Shared", sort_order: 1, active: true },
          { body: "Bait Inativo Shared", sort_order: 2, active: false },
        ],
        pool
      );

      await replaceBaitsForScope(
        "couple_men",
        [
          { body: "Bait Ativo Role", sort_order: 1, active: true },
          { body: "Bait Inativo Role", sort_order: 2, active: false },
        ],
        pool
      );

      // Default: activeOnly = true
      const activeOnlyEffective = await loadEffectiveForAccount("acc_cm_1", pool);
      assert.equal(activeOnlyEffective.archetypes.length, 2);
      assert.ok(activeOnlyEffective.archetypes.every((a) => a.active));
      assert.equal(activeOnlyEffective.baits.length, 2);
      assert.ok(activeOnlyEffective.baits.every((b) => b.active));

      // With activeOnly: false
      const allEffective = await loadEffectiveForAccount("acc_cm_1", pool, {
        activeOnly: false,
      });
      assert.equal(allEffective.archetypes.length, 4);
      assert.equal(allEffective.baits.length, 4);
    });
  });
});
