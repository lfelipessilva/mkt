import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool, getPool } from "../../src/shared/db/client.js";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";

const { Pool } = pg;

describe("Task 21: Settings, Integrations & Static Serve Backend API", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let tmpFrontendDist: string;
  const authHeaders = { authorization: "Bearer dev-token" };

  before(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const connectionString = container.getConnectionUri();
    process.env.DATABASE_URL = connectionString;
    process.env.API_KEY = "dev-token";

    // Setup temporary frontend dist directory for static serve test
    tmpFrontendDist = fs.mkdtempSync(path.join(os.tmpdir(), "shipworm-dist-"));
    fs.writeFileSync(path.join(tmpFrontendDist, "index.html"), "<!doctype html><html><body><h1>Listo App</h1></body></html>");
    fs.mkdirSync(path.join(tmpFrontendDist, "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmpFrontendDist, "assets", "app.js"), "console.log('app');");
    process.env.FRONTEND_DIST_DIR = tmpFrontendDist;

    pool = new Pool({ connectionString });
    await runMigrations(pool);

    app = await buildApp();
  });

  after(async () => {
    delete process.env.FRONTEND_DIST_DIR;
    if (tmpFrontendDist && fs.existsSync(tmpFrontendDist)) {
      fs.rmSync(tmpFrontendDist, { recursive: true, force: true });
    }
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

  beforeEach(async () => {
    await pool.query("DELETE FROM app_settings");
    await pool.query("DELETE FROM tiktok_sync_runs");
  });

  describe("Step 1: Settings API (/api/v1/settings)", () => {
    it("GET /api/v1/settings returns empty object or defaults when no settings exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/settings",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 200);
      const json = res.json();
      assert.deepEqual(json, {});
    });

    it("PUT /api/v1/settings/:key updates or creates a setting", async () => {
      const putRes = await app.inject({
        method: "PUT",
        url: "/api/v1/settings/auto_dispatch_enabled",
        headers: authHeaders,
        payload: { value: true },
      });
      assert.equal(putRes.statusCode, 200);
      const putBody = putRes.json();
      assert.equal(putBody.key, "auto_dispatch_enabled");
      assert.equal(putBody.value, true);

      // Verify with GET /api/v1/settings/:key
      const getRes = await app.inject({
        method: "GET",
        url: "/api/v1/settings/auto_dispatch_enabled",
        headers: authHeaders,
      });
      assert.equal(getRes.statusCode, 200);
      assert.equal(getRes.json().value, true);

      // Verify with GET /api/v1/settings (all)
      const getAllRes = await app.inject({
        method: "GET",
        url: "/api/v1/settings",
        headers: authHeaders,
      });
      assert.equal(getAllRes.statusCode, 200);
      assert.equal(getAllRes.json().auto_dispatch_enabled, true);

      // Update to false
      const updateRes = await app.inject({
        method: "PUT",
        url: "/api/v1/settings/auto_dispatch_enabled",
        headers: authHeaders,
        payload: { value: false },
      });
      assert.equal(updateRes.statusCode, 200);
      assert.equal(updateRes.json().value, false);
    });

    it("GET /api/v1/settings/:key returns 404 if setting not found", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/settings/non_existent_key",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 404);
    });
  });

  describe("Step 2: TikTok Sync runs API (/api/v1/tiktok/sync)", () => {
    it("GET /api/v1/tiktok/sync/latest returns null when no sync runs have executed", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/tiktok/sync/latest",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { latest: null });
    });

    it("POST /api/v1/tiktok/sync records run and GET /api/v1/tiktok/sync/latest returns it", async () => {
      const syncRes = await app.inject({
        method: "POST",
        url: "/api/v1/tiktok/sync",
        headers: authHeaders,
      });
      assert.equal(syncRes.statusCode, 200);
      const syncBody = syncRes.json();
      assert.equal(syncBody.ok, true);

      const latestRes = await app.inject({
        method: "GET",
        url: "/api/v1/tiktok/sync/latest",
        headers: authHeaders,
      });
      assert.equal(latestRes.statusCode, 200);
      const latestBody = latestRes.json();
      assert.ok(latestBody.latest);
      assert.equal(latestBody.latest.id, syncBody.sync_run_id);
      assert.equal(latestBody.latest.status, "completed");
    });
  });

  describe("Step 3: Static production serve and SPA fallback", () => {
    it("serves index.html at root '/' without auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/",
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.includes("<h1>Listo App</h1>"));
    });

    it("serves static assets under /assets/* without auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/assets/app.js",
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.includes("console.log('app');"));
    });

    it("falls back to index.html for non-API client routes", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/integracoes",
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.includes("<h1>Listo App</h1>"));
    });

    it("preserves 404 for missing /api/* routes instead of returning index.html", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/non_existent_route",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 404);
      const json = res.json();
      assert.equal(json.error, "not_found");
    });
  });
});
