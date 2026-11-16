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
import { dispatchCarouselRun } from "../../src/domain/dispatch/service.js";
import { pollPendingPostsJob } from "../../src/domain/social/polling.js";
import { syncTikTokMetricsDailyJob } from "../../src/domain/social/metricsSync.js";
import { listTikTokPerformance } from "../../src/domain/tiktok/store.js";
import type {
  SocialPublisherProvider,
  PublishPostRequest,
  PublishPostResponse,
  PostMetrics,
  SocialAccount,
} from "../../src/domain/social/types.js";

const { Pool } = pg;

describe("Task 8: Full End-to-End Verification of Buffer TikTok Publishing", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let tmpOutputDir: string;

  const testToken = "test-secret-token-e2e-buffer";
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

    tmpOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-buffer-output-"));
    process.env.OUTPUT_DIR = tmpOutputDir;
    process.env.SILO_SERVER_URL = "https://personal-minio.adaygq.easypanel.host";
    process.env.SILO_ACCESS_KEY = "test";
    process.env.SILO_SECRET_KEY = "test";
    process.env.SILO_CAROUSELS_BUCKET = "carousels";

    app = await buildApp();
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
    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE TABLE tiktok_sync_runs, tiktok_metrics, tiktok_posts, dispatch_events, media_usage, carousel_slides, carousel_runs, generation_jobs, media_assets, baits, archetypes, accounts CASCADE;"
    );

    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
      fs.mkdirSync(tmpOutputDir, { recursive: true });
    }

    // Seed test account with external_account_id linked to Buffer channel
    await pool.query(
      `INSERT INTO accounts (id, persona, role, enabled, external_account_id, social_provider)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["acc_e2e_tiktok", "Conta E2E TikTok", "single_woman", true, "buf_e2e_channel_99", "buffer"]
    );
  });

  it("completes full lifecycle: generation -> silo urls -> buffer dispatch -> polling resolution -> metrics sync -> tiktok performance ranking", async () => {
    // 1. Carousel generation & slide storage setup (simulated generation output)
    const runDir = path.join(tmpOutputDir, "acc_e2e_tiktok", "post_e2e_1");
    fs.mkdirSync(runDir, { recursive: true });

    const slide1Path = path.join(runDir, "slide_1.jpg");
    const slide2Path = path.join(runDir, "slide_2.jpg");
    fs.writeFileSync(slide1Path, "image-content-slide-1");
    fs.writeFileSync(slide2Path, "image-content-slide-2");

    const runRes = await pool.query(
      `INSERT INTO carousel_runs (
        account_id, account_role, archetype_title, bait_body, tema,
        legenda, status, output_dir, generated_at
      ) VALUES ($1, 'single_woman', 'Archetype E2E', 'Bait body E2E', 'Tema E2E Buffer',
        $2, 'generated', $3, NOW())
      RETURNING id, status, legenda, output_dir`,
      [
        "acc_e2e_tiktok",
        "Legenda E2E TikTok #viral #buffer",
        runDir,
      ]
    );
    const runId = runRes.rows[0].id;

    // Relative storage paths or paths within output dir (matching Silo storage resolution)
    await pool.query(
      `INSERT INTO carousel_slides (run_id, position, storage_path)
       VALUES ($1, 1, $2),
              ($1, 2, $3)`,
      [
        runId,
        `acc_e2e_tiktok/post_e2e_1/slide_1.jpg`,
        `acc_e2e_tiktok/post_e2e_1/slide_2.jpg`,
      ]
    );

    // 2. Set up Mock Social Provider
    const externalPostId = "buf_post_update_12345";
    let dispatchedPayload: PublishPostRequest | null = null;
    let providerStatus: "queued" | "published" = "queued";

    const mockProvider: SocialPublisherProvider = {
      providerName: "zernio" as const,

      async listConnectedAccounts(): Promise<SocialAccount[]> {
        return [
          {
            id: "buf_e2e_channel_99",
            name: "TikTok E2E Profile",
            service: "tiktok",
            channelType: "profile",
          },
        ];
      },

      async publishPost(req: PublishPostRequest): Promise<PublishPostResponse> {
        dispatchedPayload = req;
        return {
          externalPostId,
          status: "queued",
          rawResponse: { id: externalPostId, buffer_state: "queued" },
        };
      },

      async getPostStatus(id: string): Promise<PublishPostResponse> {
        assert.equal(id, externalPostId);
        return {
          externalPostId: id,
          status: providerStatus,
          rawResponse: { id, buffer_state: providerStatus },
        };
      },

      async getPostMetrics(id: string): Promise<PostMetrics | null> {
        assert.equal(id, externalPostId);
        return {
          externalPostId: id,
          views: 12500,
          likes: 850,
          comments: 42,
          shares: 18,
          rawMetrics: { sample: true },
        };
      },
    };

    // 3. Dispatch to Buffer via Dispatch Service
    const dispatchResult = await dispatchCarouselRun({
      runId,
      channel: "zernio",
      pool,
      socialPublisherProvider: mockProvider,
    });

    assert.ok(dispatchResult.event);
    assert.equal(dispatchResult.event.channel, "zernio");
    assert.equal(dispatchResult.event.status, "sent");
    assert.equal(dispatchResult.run.status, "dispatched");

    // Verify Buffer dispatch payload & slide URLs
    assert.ok(dispatchedPayload);
    assert.equal(dispatchedPayload.externalAccountId, "buf_e2e_channel_99");
    assert.equal(dispatchedPayload.publishMode, "immediate");
    assert.equal(dispatchedPayload.scheduledAt, undefined);
    assert.equal(dispatchedPayload.media.type, "carousel");
    assert.deepEqual((dispatchedPayload.media as any).imageUrls, [
      "https://personal-minio.adaygq.easypanel.host/carousels/acc_e2e_tiktok/post_e2e_1/slide_1.jpg",
      "https://personal-minio.adaygq.easypanel.host/carousels/acc_e2e_tiktok/post_e2e_1/slide_2.jpg",
    ]);

    // Verify initial tiktok_posts state
    const initialPostRes = await pool.query(
      `SELECT * FROM tiktok_posts WHERE run_id = $1`,
      [runId]
    );
    assert.equal(initialPostRes.rowCount, 1);
    assert.equal(initialPostRes.rows[0].publish_status, "queued");
    assert.equal(initialPostRes.rows[0].external_post_id, externalPostId);
    assert.equal(initialPostRes.rows[0].tracking_mode, "api");
    assert.equal(initialPostRes.rows[0].provider, "zernio");

    // 4. Polling Worker: initial poll while still queued
    const firstPollResult = await pollPendingPostsJob(pool, mockProvider);
    assert.equal(firstPollResult.checkedCount, 1);
    assert.equal(firstPollResult.updatedCount, 0);

    // Mock Buffer updates state to published
    providerStatus = "published";

    // Polling Worker: poll again to transition to published
    const secondPollResult = await pollPendingPostsJob(pool, mockProvider);
    assert.equal(secondPollResult.checkedCount, 1);
    assert.equal(secondPollResult.updatedCount, 1);

    // Verify database row transitions
    const publishedPostRes = await pool.query(
      `SELECT * FROM tiktok_posts WHERE run_id = $1`,
      [runId]
    );
    assert.equal(publishedPostRes.rows[0].publish_status, "published");
    assert.ok(publishedPostRes.rows[0].published_at);

    const updatedRunRes = await pool.query(
      `SELECT * FROM carousel_runs WHERE id = $1`,
      [runId]
    );
    assert.equal(updatedRunRes.rows[0].status, "published");

    // 5. Daily Metrics Sync Worker
    const metricsResult = await syncTikTokMetricsDailyJob(pool, mockProvider);
    assert.equal(metricsResult.postsChecked, 1);
    assert.equal(metricsResult.postsUpdated, 1);

    // Verify metrics snapshot recorded
    const metricsRows = await pool.query(
      `SELECT tm.* FROM tiktok_metrics tm
       JOIN tiktok_posts tp ON tp.id = tm.tiktok_post_id
       WHERE tp.run_id = $1`,
      [runId]
    );
    assert.equal(metricsRows.rowCount, 1);
    assert.equal(Number(metricsRows.rows[0].views), 12500);
    assert.equal(Number(metricsRows.rows[0].likes), 850);
    assert.equal(Number(metricsRows.rows[0].comments), 42);
    assert.equal(Number(metricsRows.rows[0].shares), 18);

    // 6. Verify TikTok Performance query returns updated ranking with synced metrics
    const performanceList = await listTikTokPerformance(
      { accountId: "acc_e2e_tiktok", sort: "views" },
      pool
    );
    assert.equal(performanceList.length, 1);
    assert.equal(performanceList[0].run_id, runId);
    assert.equal(performanceList[0].account_id, "acc_e2e_tiktok");
    assert.equal(performanceList[0].tracking_mode, "api");
    assert.equal(performanceList[0].views, 12500);
    assert.equal(performanceList[0].likes, 850);
    assert.equal(performanceList[0].comments, 42);
    assert.equal(performanceList[0].shares, 18);

    // Verify via HTTP GET /api/v1/tiktok/performance endpoint as well
    const httpRes = await app.inject({
      method: "GET",
      url: "/api/v1/tiktok/performance?accountId=acc_e2e_tiktok&sort=views",
      headers: authHeaders,
    });
    assert.equal(httpRes.statusCode, 200);
    const body = JSON.parse(httpRes.payload);
    assert.equal(body.length, 1);
    assert.equal(body[0].run_id, runId);
    assert.equal(body[0].views, 12500);
  });
});
