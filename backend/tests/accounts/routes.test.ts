import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { listAccounts, upsertAccount, deleteAccount } from "../../src/domain/accounts/store.js";

const { Pool } = pg;

describe("accounts routes & store", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;
  const testToken = "test-secret-token-accounts";
  const authHeaders = { authorization: `Bearer ${testToken}` };

  before(async () => {
    process.env.API_TOKEN = testToken;
    let connectionString = process.env.TEST_DATABASE_URL;

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
    await pool.query("TRUNCATE TABLE accounts CASCADE;");
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

  describe("Step 1: Test list empty -> []; POST with role: 'single_woman' -> 201; invalid role -> 400", () => {
    it("GET /api/v1/accounts returns 200 and empty array [] when no accounts exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/accounts",
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), []);
    });

    it("POST /api/v1/accounts with role: 'single_woman' returns 201 and created account", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/accounts",
        headers: authHeaders,
        payload: {
          role: "single_woman",
        },
      });

      assert.equal(res.statusCode, 201);
      const json = res.json();
      assert.equal(json.role, "single_woman");
      assert.ok(json.id, "account should have generated id");
      assert.equal(json.enabled, true);
    });

    it("POST /api/v1/accounts with invalid role returns 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/accounts",
        headers: authHeaders,
        payload: {
          role: "invalid_role",
        },
      });

      assert.equal(res.statusCode, 400);
      const json = res.json();
      assert.equal(json.error, "validation_error");
    });
  });

  describe("CRUD operations & store functions", () => {
    it("POST with full payload creates account with custom id and optional fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/accounts",
        headers: authHeaders,
        payload: {
          id: "rebeca.andrade.daily",
          display_name: "Rebeca Andrade",
          persona: "Mulher de 25 anos...",
          role: "single_woman",
          enabled: true,
          tiktok_open_id: "open_id_123",
        },
      });

      assert.equal(res.statusCode, 201);
      const json = res.json();
      assert.equal(json.id, "rebeca.andrade.daily");
      assert.equal(json.display_name, "Rebeca Andrade");
      assert.equal(json.persona, "Mulher de 25 anos...");
      assert.equal(json.role, "single_woman");
      assert.equal(json.enabled, true);
      assert.equal(json.tiktok_open_id, "open_id_123");
    });

    it("GET /api/v1/accounts lists created accounts", async () => {
      await app.inject({
        method: "POST",
        url: "/api/v1/accounts",
        headers: authHeaders,
        payload: {
          id: "acc_1",
          role: "single_man",
          persona: "Homem de 27 anos",
        },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/accounts",
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const list = res.json();
      assert.equal(list.length, 1);
      assert.equal(list[0].id, "acc_1");
      assert.equal(list[0].role, "single_man");
    });

    it("PATCH /api/v1/accounts/:id updates existing account", async () => {
      await app.inject({
        method: "POST",
        url: "/api/v1/accounts",
        headers: authHeaders,
        payload: {
          id: "acc_update",
          role: "couple_men",
          persona: "Casal...",
          enabled: true,
        },
      });

      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/accounts/acc_update",
        headers: authHeaders,
        payload: {
          enabled: false,
          display_name: "Novo Nome",
        },
      });

      assert.equal(res.statusCode, 200);
      const json = res.json();
      assert.equal(json.id, "acc_update");
      assert.equal(json.enabled, false);
      assert.equal(json.display_name, "Novo Nome");
      assert.equal(json.persona, "Casal...");
    });

    it("PATCH /api/v1/accounts/:id with non-existent id returns 404", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/accounts/non_existent",
        headers: authHeaders,
        payload: {
          display_name: "Novo Nome",
        },
      });

      assert.equal(res.statusCode, 404);
    });

    it("DELETE /api/v1/accounts/:id deletes account", async () => {
      await app.inject({
        method: "POST",
        url: "/api/v1/accounts",
        headers: authHeaders,
        payload: {
          id: "acc_del",
          role: "couple_women",
          persona: "Casal...",
        },
      });

      const delRes = await app.inject({
        method: "DELETE",
        url: "/api/v1/accounts/acc_del",
        headers: authHeaders,
      });

      assert.equal(delRes.statusCode, 200);

      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/accounts",
        headers: authHeaders,
      });
      assert.deepEqual(listRes.json(), []);
    });

    it("DELETE /api/v1/accounts/:id with non-existent id returns 404", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/v1/accounts/non_existent",
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 404);
    });

    it("verifies direct store methods: listAccounts, upsertAccount, deleteAccount", async () => {
      const initial = await listAccounts();
      assert.deepEqual(initial, []);

      const created = await upsertAccount({
        id: "store_acc_1",
        persona: "Persona test",
        role: "single_woman",
        enabled: true,
      });
      assert.equal(created.id, "store_acc_1");
      assert.equal(created.role, "single_woman");

      const afterInsert = await listAccounts();
      assert.equal(afterInsert.length, 1);
      assert.equal(afterInsert[0].id, "store_acc_1");

      await deleteAccount("store_acc_1");
      const afterDelete = await listAccounts();
      assert.deepEqual(afterDelete, []);
    });
  });
});
