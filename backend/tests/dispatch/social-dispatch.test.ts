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
import { dispatchCarouselRun, getDispatchEvents, setSocialPublisherProvider } from "../../src/domain/dispatch/service.js";
import type { SocialPublisherProvider, PublishPostRequest, PublishPostResponse } from "../../src/domain/social/types.js";

const { Pool } = pg;

describe("Task 5: Dispatch Service Integration with Social Publisher", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let tmpOutputDir: string;

  const testToken = "test-secret-token-social-dispatch";
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

    tmpOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "task5-output-"));
    process.env.OUTPUT_DIR = tmpOutputDir;
    process.env.SILO_SERVER_URL = "https://silo.example.com";
    process.env.SILO_CAROUSELS_BUCKET = "carousels";

    app = await buildApp();
  });

  beforeEach(async () => {
    setSocialPublisherProvider(null);
    await pool.query(
      "TRUNCATE TABLE tiktok_posts, dispatch_events, media_usage, carousel_slides, carousel_runs, generation_jobs, media_assets, baits, archetypes, accounts CASCADE;"
    );

    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
      fs.mkdirSync(tmpOutputDir, { recursive: true });
    }

    // Seed test account with external_account_id
    await pool.query(
      `INSERT INTO accounts (id, persona, role, enabled, external_account_id, social_provider)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["acc_buffer_test", "Conta de Teste Buffer", "single_woman", true, "buf_channel_123", "buffer"]
    );
  });

  after(async () => {
    setSocialPublisherProvider(null);
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
    const runDir = path.join(tmpOutputDir, "acc_buffer_test", "run_1");
    fs.mkdirSync(runDir, { recursive: true });

    const slide1Path = path.join(runDir, "slide_1.jpg");
    const slide2Path = path.join(runDir, "slide_2.jpg");
    fs.writeFileSync(slide1Path, "dummy-image-1");
    fs.writeFileSync(slide2Path, "dummy-image-2");

    const runRes = await pool.query(
      `INSERT INTO carousel_runs (
        account_id, account_role, archetype_title, bait_body, tema,
        legenda, status, output_dir, generated_at
      ) VALUES ($1, 'single_woman', 'Archetype Title', 'Bait body', 'Tema teste Buffer',
        $2, $3, $4, NOW())
      RETURNING id, status, legenda, output_dir`,
      [
        "acc_buffer_test",
        overrides.legenda ?? "Legenda teste #buffer",
        overrides.status || "generated",
        runDir,
      ]
    );
    const runId = runRes.rows[0].id;

    await pool.query(
      `INSERT INTO carousel_slides (run_id, position, storage_path)
       VALUES ($1, 1, $2),
              ($1, 2, $3)`,
      [runId, slide1Path, slide2Path]
    );

    return runId;
  }

  it("dispatches run with channel = 'buffer', calls provider, records event and creates tiktok_posts row", async () => {
    const runId = await createSampleRun();

    let publishedReq: PublishPostRequest | null = null;
    const mockProvider: SocialPublisherProvider = {
      async listConnectedAccounts() {
        return [];
      },
      async publishPost(req: PublishPostRequest): Promise<PublishPostResponse> {
        publishedReq = req;
        return {
          externalPostId: "ext_buf_update_999",
          status: "queued",
          rawResponse: { id: "ext_buf_update_999", status: "buffer_queued" },
        };
      },
      async getPostStatus(id: string) {
        return { externalPostId: id, status: "queued", rawResponse: {} };
      },
      async getPostMetrics(id: string) {
        return { externalPostId: id, views: 0, likes: 0, comments: 0, shares: 0, rawMetrics: {} };
      },
    };

    const beforeDispatch = Date.now();
    const res = await dispatchCarouselRun({
      runId,
      channel: "buffer",
      pool,
      socialPublisherProvider: mockProvider,
    });

    assert.ok(res.event);
    assert.equal(res.event.channel, "buffer");
    assert.equal(res.event.status, "sent");
    assert.equal(res.run.status, "dispatched");

    // Verify provider call
    assert.ok(publishedReq);
    assert.equal(publishedReq.externalAccountId, "buf_channel_123");
    assert.equal(publishedReq.publishMode, "scheduled");
    assert.equal(publishedReq.schedulingType, "notification");
    assert.ok(publishedReq.scheduledAt);
    const scheduledTime = new Date(publishedReq.scheduledAt).getTime();
    const expectedTime = beforeDispatch + 30 * 60 * 1000;
    assert.ok(
      Math.abs(scheduledTime - expectedTime) < 2000,
      `scheduledAt (${publishedReq.scheduledAt}) should be within 2s of now+30m`
    );
    assert.equal(publishedReq.media.type, "carousel");
    assert.equal((publishedReq.media as any).imageUrls.length, 2);

    // Verify tiktok_posts row
    const postRes = await pool.query(
      `SELECT * FROM tiktok_posts WHERE run_id = $1`,
      [runId]
    );
    assert.equal(postRes.rows.length, 1);
    const post = postRes.rows[0];
    assert.equal(post.tracking_mode, "api");
    assert.equal(post.provider, "buffer");
    assert.equal(post.external_post_id, "ext_buf_update_999");
    assert.equal(post.publish_status, "queued");

    // Verify dispatch_events
    const events = await getDispatchEvents(runId, pool);
    assert.equal(events.length, 1);
    assert.equal(events[0].channel, "buffer");
    assert.equal(events[0].status, "sent");
  });

  it("fails when account has no external_account_id configured", async () => {
    // Account without external_account_id
    await pool.query(
      `INSERT INTO accounts (id, persona, role, enabled)
       VALUES ($1, $2, $3, $4)`,
      ["acc_no_ext", "Conta Sem Ext ID", "single_man", true]
    );

    const runDir = path.join(tmpOutputDir, "acc_no_ext", "run_1");
    fs.mkdirSync(runDir, { recursive: true });
    const slide1 = path.join(runDir, "slide_1.jpg");
    fs.writeFileSync(slide1, "slide");

    const runRes = await pool.query(
      `INSERT INTO carousel_runs (
        account_id, account_role, archetype_title, bait_body, tema,
        legenda, status, output_dir, generated_at
      ) VALUES ($1, 'single_man', 'Archetype', 'Bait', 'Tema', 'Legenda', 'generated', $2, NOW())
      RETURNING id`,
      ["acc_no_ext", runDir]
    );
    const runId = runRes.rows[0].id;

    await pool.query(
      `INSERT INTO carousel_slides (run_id, position, storage_path)
       VALUES ($1, 1, $2)`,
      [runId, slide1]
    );

    await assert.rejects(
      async () => {
        await dispatchCarouselRun({
          runId,
          channel: "buffer",
          pool,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "config_error");
        return true;
      }
    );
  });

  it("treats provider status=failed as dispatch error without marking run dispatched", async () => {
    const runId = await createSampleRun();

    const mockProvider: SocialPublisherProvider = {
      async listConnectedAccounts() {
        return [];
      },
      async publishPost(): Promise<PublishPostResponse> {
        return {
          externalPostId: "ext_buf_failed_1",
          status: "failed",
          errorMessage: "MutationError: channel rejected",
          rawResponse: { error: "MutationError" },
        };
      },
      async getPostStatus(id: string) {
        return { externalPostId: id, status: "failed", rawResponse: {} };
      },
      async getPostMetrics(id: string) {
        return { externalPostId: id, views: 0, likes: 0, comments: 0, shares: 0, rawMetrics: {} };
      },
    };

    await assert.rejects(
      async () => {
        await dispatchCarouselRun({
          runId,
          channel: "buffer",
          pool,
          socialPublisherProvider: mockProvider,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 502);
        assert.equal(err.code, "dispatch_failed");
        assert.match(String(err.message), /MutationError|failed|rejected/i);
        return true;
      }
    );

    const runRes = await pool.query(`SELECT status FROM carousel_runs WHERE id = $1`, [runId]);
    assert.equal(runRes.rows[0].status, "generated");

    const postRes = await pool.query(
      `SELECT publish_status, external_post_id FROM tiktok_posts WHERE run_id = $1`,
      [runId]
    );
    assert.equal(postRes.rows.length, 1);
    assert.equal(postRes.rows[0].publish_status, "failed");
    assert.equal(postRes.rows[0].external_post_id, "ext_buf_failed_1");

    const events = await getDispatchEvents(runId, pool);
    assert.equal(events.length, 1);
    assert.equal(events[0].status, "failed");
    assert.equal(events[0].channel, "buffer");
  });

  it("POST /api/v1/carousels/runs/:id/send?channel=buffer routes properly through API endpoint", async () => {
    const runId = await createSampleRun();

    let publishedReq: PublishPostRequest | null = null;
    const mockProvider: SocialPublisherProvider = {
      async listConnectedAccounts() {
        return [];
      },
      async publishPost(req: PublishPostRequest): Promise<PublishPostResponse> {
        publishedReq = req;
        return {
          externalPostId: "ext_buf_update_route_123",
          status: "queued",
          rawResponse: { id: "ext_buf_update_route_123" },
        };
      },
      async getPostStatus(id: string) {
        return { externalPostId: id, status: "queued", rawResponse: {} };
      },
      async getPostMetrics(id: string) {
        return { externalPostId: id, views: 0, likes: 0, comments: 0, shares: 0, rawMetrics: {} };
      },
    };
    setSocialPublisherProvider(mockProvider);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/carousels/runs/${runId}/send?channel=buffer`,
      headers: authHeaders,
    });

    const json = response.json();
    assert.equal(response.statusCode, 200);
    assert.equal(json.ok, true);
    assert.equal(json.event.channel, "buffer");
    assert.equal(json.event.status, "sent");
    assert.ok(publishedReq);
    assert.equal((publishedReq as PublishPostRequest).publishMode, "scheduled");
    assert.equal((publishedReq as PublishPostRequest).schedulingType, "notification");
  });

  it("dispatches run with channel = 'social', leaves publishMode as immediate without schedulingType", async () => {
    const runId = await createSampleRun();

    let publishedReq: PublishPostRequest | null = null;
    const mockProvider: SocialPublisherProvider = {
      async listConnectedAccounts() {
        return [];
      },
      async publishPost(req: PublishPostRequest): Promise<PublishPostResponse> {
        publishedReq = req;
        return {
          externalPostId: "ext_soc_update_111",
          status: "queued",
          rawResponse: { id: "ext_soc_update_111" },
        };
      },
      async getPostStatus(id: string) {
        return { externalPostId: id, status: "queued", rawResponse: {} };
      },
      async getPostMetrics(id: string) {
        return { externalPostId: id, views: 0, likes: 0, comments: 0, shares: 0, rawMetrics: {} };
      },
    };

    const res = await dispatchCarouselRun({
      runId,
      channel: "social",
      pool,
      socialPublisherProvider: mockProvider,
    });

    assert.ok(res.event);
    assert.equal(res.event.channel, "social");
    assert.equal(res.event.status, "sent");
    assert.equal(res.run.status, "dispatched");

    assert.ok(publishedReq);
    assert.equal(publishedReq.publishMode, "immediate");
    assert.equal(publishedReq.schedulingType, undefined);
    assert.equal(publishedReq.scheduledAt, undefined);
  });
});
