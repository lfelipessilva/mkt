import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import {
  listArchetypes,
  replaceArchetypesForScope,
} from "../../src/domain/archetypes/store.js";
import {
  listBaits,
  replaceBaitsForScope,
} from "../../src/domain/baits/store.js";

const { Pool } = pg;

describe("scoped archetypes & baits CRUD (by scope)", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;
  const testToken = "test-secret-token-content";
  const authHeaders = { authorization: `Bearer ${testToken}` };

  before(async () => {
    process.env.API_TOKEN = testToken;
    let connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      connectionString = container.getConnectionUri();
      process.env.DATABASE_URL = connectionString;
    }

    pool = new Pool({ connectionString });
    await runMigrations(pool);
    app = await buildApp();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE archetypes, baits CASCADE;");
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    await closePool();
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  describe("Step 1: PUT archetypes for couple_men then GET returns ordered titles", () => {
    it("PUT /api/v1/archetypes saves items for couple_men, and GET returns them ordered by sort_order", async () => {
      const putRes = await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "couple_men",
          items: [
            { title: "Romance na Praia", sort_order: 2, active: true },
            { title: "Viagem dos Sonhos", sort_order: 1, active: true },
            { title: "Primeiro Encontro", sort_order: 3, active: false },
          ],
        },
      });

      assert.equal(putRes.statusCode, 200);
      const putData = putRes.json();
      assert.equal(putData.length, 3);

      const getRes = await app.inject({
        method: "GET",
        url: "/api/v1/archetypes?scope=couple_men",
        headers: authHeaders,
      });

      assert.equal(getRes.statusCode, 200);
      const getData = getRes.json();
      assert.equal(getData.length, 3);
      assert.deepEqual(
        getData.map((a: { title: string }) => a.title),
        ["Viagem dos Sonhos", "Romance na Praia", "Primeiro Encontro"]
      );
      assert.equal(getData[0].scope, "couple_men");
      assert.equal(getData[0].sort_order, 1);
      assert.equal(getData[2].active, false);
      assert.ok(getData[0].id);
    });
  });

  describe("Step 2: Enforce UNIQUE(scope, title) on upsert (update in place)", () => {
    it("updates existing archetype in place when same (scope, title) is provided, preserving ID", async () => {
      // First insert
      const firstPut = await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "couple_men",
          items: [
            { title: "Amor Eterno", sort_order: 1, active: true },
          ],
        },
      });
      assert.equal(firstPut.statusCode, 200);
      const [initialItem] = firstPut.json();
      const initialId = initialItem.id;
      assert.ok(initialId);

      // Second PUT with same title, updated sort_order and active
      const secondPut = await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "couple_men",
          items: [
            { title: "Amor Eterno", sort_order: 99, active: false },
          ],
        },
      });
      assert.equal(secondPut.statusCode, 200);
      const [updatedItem] = secondPut.json();

      assert.equal(updatedItem.id, initialId, "Should retain the same UUID");
      assert.equal(updatedItem.sort_order, 99);
      assert.equal(updatedItem.active, false);

      // Verify DB table has exactly 1 row
      const dbCheck = await pool.query(
        "SELECT COUNT(*)::int as count FROM archetypes WHERE scope = 'couple_men' AND title = 'Amor Eterno'"
      );
      assert.equal(dbCheck.rows[0].count, 1);
    });

    it("renames existing archetype when existing id is provided with changed title (rename-by-id)", async () => {
      // 1. Initial insert
      const initialPut = await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "couple_men",
          items: [
            { title: "Titulo Antigo", sort_order: 0, active: true },
          ],
        },
      });
      assert.equal(initialPut.statusCode, 200);
      const [initialItem] = initialPut.json();
      const initialId = initialItem.id;
      assert.ok(initialId);

      // 2. PUT with existing ID but changed title
      const renamePut = await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "couple_men",
          items: [
            { id: initialId, title: "Titulo Novo Renomeado", sort_order: 2, active: true },
          ],
        },
      });
      assert.equal(renamePut.statusCode, 200);
      const [renamedItem] = renamePut.json();
      assert.equal(renamedItem.id, initialId, "Must preserve the existing archetype id");
      assert.equal(renamedItem.title, "Titulo Novo Renomeado");
      assert.equal(renamedItem.sort_order, 2);

      // 3. Verify via GET
      const getRes = await app.inject({
        method: "GET",
        url: "/api/v1/archetypes?scope=couple_men",
        headers: authHeaders,
      });
      assert.equal(getRes.statusCode, 200);
      const items = getRes.json();
      assert.equal(items.length, 1);
      assert.equal(items[0].id, initialId);
      assert.equal(items[0].title, "Titulo Novo Renomeado");

      // 4. Verify in DB
      const oldCheck = await pool.query(
        "SELECT COUNT(*)::int as count FROM archetypes WHERE scope = 'couple_men' AND title = 'Titulo Antigo'"
      );
      assert.equal(oldCheck.rows[0].count, 0);

      const newCheck = await pool.query(
        "SELECT COUNT(*)::int as count FROM archetypes WHERE scope = 'couple_men' AND title = 'Titulo Novo Renomeado' AND id = $1",
        [initialId]
      );
      assert.equal(newCheck.rows[0].count, 1);
    });

    it("replaces list for the scope by removing items no longer in the payload", async () => {
      // Seed with 2 items
      await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "couple_men",
          items: [
            { title: "Item 1", sort_order: 0 },
            { title: "Item 2", sort_order: 1 },
          ],
        },
      });

      // Replace with only Item 2 and a new Item 3
      const replaceRes = await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "couple_men",
          items: [
            { title: "Item 2", sort_order: 0 },
            { title: "Item 3", sort_order: 1 },
          ],
        },
      });
      assert.equal(replaceRes.statusCode, 200);

      const getRes = await app.inject({
        method: "GET",
        url: "/api/v1/archetypes?scope=couple_men",
        headers: authHeaders,
      });
      const items = getRes.json();
      assert.equal(items.length, 2);
      assert.deepEqual(
        items.map((i: { title: string }) => i.title),
        ["Item 2", "Item 3"]
      );
    });

    it("does not affect other scopes when replacing archetypes for a scope", async () => {
      // Add items to shared scope
      await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "shared",
          items: [{ title: "Shared Arch", sort_order: 0 }],
        },
      });

      // Add items to couple_men scope
      await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "couple_men",
          items: [{ title: "Men Arch", sort_order: 0 }],
        },
      });

      // Clear couple_men
      await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "couple_men",
          items: [],
        },
      });

      // Check shared is still intact
      const sharedRes = await app.inject({
        method: "GET",
        url: "/api/v1/archetypes?scope=shared",
        headers: authHeaders,
      });
      assert.equal(sharedRes.json().length, 1);
      assert.equal(sharedRes.json()[0].title, "Shared Arch");
    });
  });

  describe("Step 3: Baits resource (same pattern) & validations", () => {
    it("PUT /api/v1/baits saves items for scope, and GET returns them ordered by sort_order", async () => {
      const putRes = await app.inject({
        method: "PUT",
        url: "/api/v1/baits",
        headers: authHeaders,
        payload: {
          scope: "shared",
          items: [
            { body: "Você não vai acreditar nisso...", sort_order: 2, active: true },
            { body: "O segredo que ninguém te conta:", sort_order: 1, active: true },
          ],
        },
      });

      assert.equal(putRes.statusCode, 200);
      const putData = putRes.json();
      assert.equal(putData.length, 2);

      const getRes = await app.inject({
        method: "GET",
        url: "/api/v1/baits?scope=shared",
        headers: authHeaders,
      });

      assert.equal(getRes.statusCode, 200);
      const getData = getRes.json();
      assert.equal(getData.length, 2);
      assert.deepEqual(
        getData.map((b: { body: string }) => b.body),
        ["O segredo que ninguém te conta:", "Você não vai acreditar nisso..."]
      );
      assert.equal(getData[0].scope, "shared");
      assert.equal(getData[0].sort_order, 1);
    });

    it("updates existing bait in place when same (scope, body) is provided, preserving ID", async () => {
      const firstPut = await app.inject({
        method: "PUT",
        url: "/api/v1/baits",
        headers: authHeaders,
        payload: {
          scope: "single_woman",
          items: [{ body: "Dica imperdível de estilo", sort_order: 1, active: true }],
        },
      });
      assert.equal(firstPut.statusCode, 200);
      const [initialBait] = firstPut.json();
      const initialId = initialBait.id;

      const secondPut = await app.inject({
        method: "PUT",
        url: "/api/v1/baits",
        headers: authHeaders,
        payload: {
          scope: "single_woman",
          items: [{ body: "Dica imperdível de estilo", sort_order: 5, active: false }],
        },
      });
      assert.equal(secondPut.statusCode, 200);
      const [updatedBait] = secondPut.json();

      assert.equal(updatedBait.id, initialId, "Should retain the same UUID");
      assert.equal(updatedBait.sort_order, 5);
      assert.equal(updatedBait.active, false);

      const dbCheck = await pool.query(
        "SELECT COUNT(*)::int as count FROM baits WHERE scope = 'single_woman' AND body = 'Dica imperdível de estilo'"
      );
      assert.equal(dbCheck.rows[0].count, 1);
    });

    it("replaces baits list for the scope by removing omitted items", async () => {
      await app.inject({
        method: "PUT",
        url: "/api/v1/baits",
        headers: authHeaders,
        payload: {
          scope: "single_man",
          items: [
            { body: "Bait 1", sort_order: 0 },
            { body: "Bait 2", sort_order: 1 },
          ],
        },
      });

      await app.inject({
        method: "PUT",
        url: "/api/v1/baits",
        headers: authHeaders,
        payload: {
          scope: "single_man",
          items: [
            { body: "Bait 2", sort_order: 0 },
            { body: "Bait 3", sort_order: 1 },
          ],
        },
      });

      const getRes = await app.inject({
        method: "GET",
        url: "/api/v1/baits?scope=single_man",
        headers: authHeaders,
      });
      const items = getRes.json();
      assert.equal(items.length, 2);
      assert.deepEqual(
        items.map((b: { body: string }) => b.body),
        ["Bait 2", "Bait 3"]
      );
    });

    it("supports direct store functions for archetypes and baits", async () => {
      await replaceArchetypesForScope(
        "couple_women",
        [
          { title: "Direct Archetype 1", sort_order: 1, active: true },
          { title: "Direct Archetype 2", sort_order: 0, active: true },
        ],
        pool
      );

      const directArchs = await listArchetypes("couple_women", pool);
      assert.equal(directArchs.length, 2);
      assert.equal(directArchs[0].title, "Direct Archetype 2");
      assert.equal(directArchs[1].title, "Direct Archetype 1");

      await replaceBaitsForScope(
        "couple_women",
        [
          { body: "Direct Bait 1", sort_order: 1, active: true },
          { body: "Direct Bait 2", sort_order: 0, active: true },
        ],
        pool
      );

      const directBaits = await listBaits("couple_women", pool);
      assert.equal(directBaits.length, 2);
      assert.equal(directBaits[0].body, "Direct Bait 2");
      assert.equal(directBaits[1].body, "Direct Bait 1");
    });

    it("rejects invalid scope or missing fields with 400", async () => {
      const resInvalidScope = await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "invalid_scope",
          items: [{ title: "Test", sort_order: 0 }],
        },
      });
      assert.equal(resInvalidScope.statusCode, 400);

      const resMissingTitle = await app.inject({
        method: "PUT",
        url: "/api/v1/archetypes",
        headers: authHeaders,
        payload: {
          scope: "shared",
          items: [{ sort_order: 0 }],
        },
      });
      assert.equal(resMissingTitle.statusCode, 400);

      const resInvalidBaitScope = await app.inject({
        method: "GET",
        url: "/api/v1/baits?scope=invalid_scope",
        headers: authHeaders,
      });
      assert.equal(resInvalidBaitScope.statusCode, 400);
    });

    it("requires authentication for endpoints", async () => {
      const getArchNoAuth = await app.inject({
        method: "GET",
        url: "/api/v1/archetypes?scope=shared",
      });
      assert.equal(getArchNoAuth.statusCode, 401);

      const putBaitNoAuth = await app.inject({
        method: "PUT",
        url: "/api/v1/baits",
        payload: {
          scope: "shared",
          items: [{ body: "No auth bait" }],
        },
      });
      assert.equal(putBaitNoAuth.statusCode, 401);
    });
  });
});
