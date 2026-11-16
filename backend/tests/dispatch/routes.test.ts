import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import {
  setTelegramSender,
  setFetchFn,
  getDispatchEvents,
} from "../../src/domain/dispatch/service.js";

const { Pool } = pg;

describe("Task 15: Dispatch (Send button) routes & service", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let tmpOutputDir: string;

  const testToken = "test-secret-token-dispatch";
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

    tmpOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "task15-output-"));
    process.env.OUTPUT_DIR = tmpOutputDir;

    app = await buildApp();
  });

  beforeEach(async () => {
    setTelegramSender(null);
    setFetchFn(null);
    delete process.env.DISPATCH_WEBHOOK_URL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    await pool.query(
      "TRUNCATE TABLE dispatch_events, media_usage, carousel_slides, carousel_runs, generation_jobs, media_assets, baits, archetypes, accounts CASCADE;"
    );

    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
      fs.mkdirSync(tmpOutputDir, { recursive: true });
    }

    // Seed test account
    await upsertAccount(
      {
        id: "acc_dispatch_test",
        persona: "Conta de Teste Dispatch",
        role: "single_woman",
        enabled: true,
      },
      pool
    );
  });

  after(async () => {
    setTelegramSender(null);
    setFetchFn(null);
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
    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
    }
  });

  async function createSampleRun(overrides: { status?: string; legenda?: string } = {}) {
    const runDir = path.join(tmpOutputDir, "acc_dispatch_test", "run_1");
    fs.mkdirSync(runDir, { recursive: true });

    const slide1Path = path.join(runDir, "slide_1.jpg");
    const slide2Path = path.join(runDir, "slide_2.jpg");
    fs.writeFileSync(slide1Path, "slide 1 content");
    fs.writeFileSync(slide2Path, "slide 2 content");

    const runRes = await pool.query(
      `INSERT INTO carousel_runs (
        account_id, account_role, archetype_title, bait_body, tema,
        legenda, status, output_dir, generated_at
      ) VALUES ($1, 'single_woman', 'Archetype Title', 'Bait body', 'Tema Escolhido',
        $2, $3, $4, NOW())
      RETURNING id, status, legenda, output_dir`,
      [
        "acc_dispatch_test",
        overrides.legenda ?? "Legenda de teste #dicas #moda",
        overrides.status ?? "generated",
        runDir,
      ]
    );
    const runId = runRes.rows[0].id;

    await pool.query(
      `INSERT INTO carousel_slides (run_id, position, storage_path)
       VALUES ($1, 1, $2), ($1, 2, $3)`,
      [runId, slide1Path, slide2Path]
    );

    return { runId, runDir, slide1Path, slide2Path };
  }

  describe("Step 1: Telegram send mocked -> event sent, run status updated", () => {
    it("POST /api/v1/carousels/runs/:id/send?channel=telegram sends album, updates run to dispatched, records event", async () => {
      const { runId, slide1Path, slide2Path } = await createSampleRun();

      process.env.TELEGRAM_BOT_TOKEN = "dummy_bot_token";
      process.env.TELEGRAM_CHAT_ID = "-100123456789";

      let capturedCall: any = null;
      setTelegramSender(async (opts) => {
        capturedCall = opts;
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${runId}/send?channel=telegram`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);

      assert.equal(body.ok, true);
      assert.equal(body.event.channel, "telegram");
      assert.equal(body.event.status, "sent");
      assert.equal(body.event.triggered_by, "manual");
      assert.ok(body.event.sent_at);
      assert.equal(body.run.status, "dispatched");

      // Verify DB run status
      const dbRunRes = await pool.query(
        "SELECT status FROM carousel_runs WHERE id = $1",
        [runId]
      );
      assert.equal(dbRunRes.rows[0].status, "dispatched");

      // Verify DB dispatch_events row
      const events = await getDispatchEvents(runId, pool);
      assert.equal(events.length, 1);
      assert.equal(events[0].channel, "telegram");
      assert.equal(events[0].status, "sent");
      assert.equal(events[0].triggered_by, "manual");
      assert.ok(events[0].sent_at);

      // Verify telegram sender was called with slides and legenda
      assert.ok(capturedCall);
      assert.equal(capturedCall.chatId, "-100123456789");
      assert.equal(capturedCall.accountId, "acc_dispatch_test");
      assert.deepEqual(capturedCall.imagePaths, [slide1Path, slide2Path]);
      assert.equal(capturedCall.legenda, "Legenda de teste #dicas #moda");
    });

    it("POST /api/v1/carousels/runs/:id/send defaults to telegram channel if channel query is omitted", async () => {
      const { runId } = await createSampleRun();

      process.env.TELEGRAM_BOT_TOKEN = "dummy_bot_token";
      process.env.TELEGRAM_CHAT_ID = "987654";

      let called = false;
      setTelegramSender(async () => {
        called = true;
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${runId}/send`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.event.channel, "telegram");
      assert.equal(called, true);
    });

    it("returns 404 for unknown run id", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "dummy_bot_token";
      process.env.TELEGRAM_CHAT_ID = "12345";

      const fakeId = "00000000-0000-0000-0000-000000000000";
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${fakeId}/send?channel=telegram`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.error, "not_found");
    });

    it("records status=failed in dispatch_events when telegram send throws", async () => {
      const { runId } = await createSampleRun();

      process.env.TELEGRAM_BOT_TOKEN = "dummy_bot_token";
      process.env.TELEGRAM_CHAT_ID = "12345";

      setTelegramSender(async () => {
        throw new Error("Telegram network timeout");
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${runId}/send?channel=telegram`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 502);

      // Verify DB run status is NOT updated to dispatched
      const dbRunRes = await pool.query(
        "SELECT status FROM carousel_runs WHERE id = $1",
        [runId]
      );
      assert.equal(dbRunRes.rows[0].status, "generated");

      // Verify dispatch_events has failed status
      const events = await getDispatchEvents(runId, pool);
      assert.equal(events.length, 1);
      assert.equal(events[0].channel, "telegram");
      assert.equal(events[0].status, "failed");
      assert.equal(events[0].sent_at, null);
      assert.ok(events[0].response_payload?.error?.includes("Telegram network timeout"));
    });

    it("returns 400 when telegram credentials are missing", async () => {
      const { runId } = await createSampleRun();

      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${runId}/send?channel=telegram`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.message.includes("TELEGRAM"));
    });
  });

  describe("Step 2: API channel POSTs to DISPATCH_WEBHOOK_URL with slide paths + legenda JSON", () => {
    it("POST /api/v1/carousels/runs/:id/send?channel=api calls DISPATCH_WEBHOOK_URL with slide paths and legenda", async () => {
      const { runId, slide1Path, slide2Path } = await createSampleRun();

      const webhookUrl = "https://webhook.example.com/dispatch";
      process.env.DISPATCH_WEBHOOK_URL = webhookUrl;

      let capturedUrl = "";
      let capturedInit: any = null;

      setFetchFn(async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ success: true, tracking_id: "tr_123" }),
          text: async () => JSON.stringify({ success: true }),
        } as any;
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${runId}/send?channel=api`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);

      assert.equal(body.ok, true);
      assert.equal(body.event.channel, "api");
      assert.equal(body.event.status, "sent");
      assert.equal(body.event.triggered_by, "manual");
      assert.ok(body.event.sent_at);
      assert.equal(body.run.status, "dispatched");

      // Verify DB run status
      const dbRunRes = await pool.query(
        "SELECT status FROM carousel_runs WHERE id = $1",
        [runId]
      );
      assert.equal(dbRunRes.rows[0].status, "dispatched");

      // Verify DB dispatch_events row
      const events = await getDispatchEvents(runId, pool);
      assert.equal(events.length, 1);
      assert.equal(events[0].channel, "api");
      assert.equal(events[0].status, "sent");
      assert.ok(events[0].sent_at);

      // Verify fetch call parameters
      assert.equal(capturedUrl, webhookUrl);
      assert.equal(capturedInit?.method, "POST");
      assert.equal(
        capturedInit?.headers?.["Content-Type"] || capturedInit?.headers?.["content-type"],
        "application/json"
      );

      const parsedPayload = JSON.parse(capturedInit?.body);
      assert.equal(parsedPayload.run_id, runId);
      assert.equal(parsedPayload.account_id, "acc_dispatch_test");
      assert.equal(parsedPayload.legenda, "Legenda de teste #dicas #moda");
      assert.deepEqual(parsedPayload.slide_paths, [slide1Path, slide2Path]);
    });

    it("returns 400 when DISPATCH_WEBHOOK_URL is missing", async () => {
      const { runId } = await createSampleRun();
      delete process.env.DISPATCH_WEBHOOK_URL;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${runId}/send?channel=api`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.message.includes("DISPATCH_WEBHOOK_URL"));
    });

    it("records status=failed in dispatch_events when webhook returns non-2xx status", async () => {
      const { runId } = await createSampleRun();
      process.env.DISPATCH_WEBHOOK_URL = "https://webhook.example.com/dispatch";

      setFetchFn(async () => {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Upstream system down",
          json: async () => ({ error: "Upstream system down" }),
        } as any;
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${runId}/send?channel=api`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 502);

      // Verify DB run status is NOT updated
      const dbRunRes = await pool.query(
        "SELECT status FROM carousel_runs WHERE id = $1",
        [runId]
      );
      assert.equal(dbRunRes.rows[0].status, "generated");

      // Verify dispatch_events has failed status and details
      const events = await getDispatchEvents(runId, pool);
      assert.equal(events.length, 1);
      assert.equal(events[0].channel, "api");
      assert.equal(events[0].status, "failed");
      assert.equal(events[0].sent_at, null);
      assert.ok(
        events[0].response_payload?.error?.includes("500") ||
        events[0].response_payload?.body?.includes("Upstream system down")
      );
    });

    it("returns 400 validation error for invalid channel", async () => {
      const { runId } = await createSampleRun();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${runId}/send?channel=invalid_channel`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 400);
    });

    it("requires authentication for /send endpoint", async () => {
      const { runId } = await createSampleRun();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/carousels/runs/${runId}/send?channel=telegram`,
      });

      assert.equal(res.statusCode, 401);
    });
  });
});
