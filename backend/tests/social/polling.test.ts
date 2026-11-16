import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { pollPendingPostsJob } from "../../src/domain/social/polling.js";
import type { SocialPublisherProvider, PublishPostRequest, PublishPostResponse, PostMetrics, SocialAccount } from "../../src/domain/social/types.js";

const { Pool } = pg;

describe("Task 6: Polling Worker (pollPendingPostsJob)", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;

  before(async () => {
    process.env.SILO_SERVER_URL = "https://silo.example.com";
    process.env.SILO_CAROUSELS_BUCKET = "carousels";
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
    await pool.query(
      "TRUNCATE TABLE tiktok_posts, dispatch_events, media_usage, carousel_slides, carousel_runs, generation_jobs, media_assets, baits, archetypes, accounts CASCADE;"
    );

    await pool.query(
      `INSERT INTO accounts (id, persona, role, enabled, external_account_id, social_provider)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["acc_polling_test", "Conta Polling Teste", "single_woman", true, "buf_poll_chan_1", "buffer"]
    );
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

  async function createTestRunAndPost(options: {
    runId?: string;
    publishStatus: string;
    externalPostId?: string;
    scheduledAt?: Date | null;
    createdAt?: Date;
  }) {
    const runRes = await pool.query(
      `INSERT INTO carousel_runs (
        account_id, account_role, archetype_title, bait_body, tema,
        legenda, status, output_dir, generated_at
      ) VALUES ($1, 'single_woman', 'Archetype Title', 'Bait body', 'Tema teste Polling',
        'Legenda teste', 'generated', '/tmp/dummy', NOW())
      RETURNING id`,
      ["acc_polling_test"]
    );
    const runId = options.runId || runRes.rows[0].id;

    const postRes = await pool.query(
      `INSERT INTO tiktok_posts (
        run_id, tracking_mode, provider, external_post_id, publish_status, scheduled_at, created_at, updated_at
      ) VALUES ($1, 'api', 'buffer', $2, $3, $4, COALESCE($5, NOW()), NOW())
      RETURNING id, run_id, publish_status, external_post_id, published_at`,
      [
        runId,
        options.externalPostId ?? "ext_post_123",
        options.publishStatus,
        options.scheduledAt ?? null,
        options.createdAt ?? null,
      ]
    );

    return { runId, post: postRes.rows[0] };
  }

  it("transitions post in status 'queued' to 'published' when Buffer returns 'published', updating carousel_runs and tiktok_posts", async () => {
    const { runId } = await createTestRunAndPost({
      publishStatus: "queued",
      externalPostId: "ext_post_buf_001",
    });

    const mockSentAt = new Date().toISOString();
    const mockProvider: SocialPublisherProvider = {
      providerName: "buffer",
      async listConnectedAccounts(): Promise<SocialAccount[]> { return []; },
      async publishPost(_req: PublishPostRequest): Promise<PublishPostResponse> {
        throw new Error("not called in this test");
      },
      async getPostStatus(externalPostId: string): Promise<PublishPostResponse> {
        assert.equal(externalPostId, "ext_post_buf_001");
        return {
          externalPostId,
          status: "published",
          publishedAt: mockSentAt,
          rawResponse: { id: externalPostId, status: "sent" },
        };
      },
      async getPostMetrics(_externalPostId: string): Promise<PostMetrics | null> { return null; },
    };

    const res = await pollPendingPostsJob(pool, mockProvider);
    assert.equal(res.checkedCount, 1);
    assert.equal(res.updatedCount, 1);

    const postCheck = await pool.query(
      "SELECT publish_status, published_at, last_polled_at FROM tiktok_posts WHERE run_id = $1",
      [runId]
    );
    assert.equal(postCheck.rows[0].publish_status, "published");
    assert.ok(postCheck.rows[0].published_at, "published_at should be populated");
    assert.ok(postCheck.rows[0].last_polled_at, "last_polled_at should be populated");

    const runCheck = await pool.query(
      "SELECT status FROM carousel_runs WHERE id = $1",
      [runId]
    );
    assert.equal(runCheck.rows[0].status, "published");
  });

  it("transitions post to 'failed' when Buffer returns 'failed'", async () => {
    const { runId } = await createTestRunAndPost({
      publishStatus: "processing",
      externalPostId: "ext_post_buf_fail",
    });

    const mockProvider: SocialPublisherProvider = {
      providerName: "buffer",
      async listConnectedAccounts(): Promise<SocialAccount[]> { return []; },
      async publishPost(_req: PublishPostRequest): Promise<PublishPostResponse> {
        throw new Error("not called");
      },
      async getPostStatus(externalPostId: string): Promise<PublishPostResponse> {
        return {
          externalPostId,
          status: "failed",
          errorMessage: "Failed at provider level",
          rawResponse: { id: externalPostId, error: "Something broke" },
        };
      },
      async getPostMetrics(_externalPostId: string): Promise<PostMetrics | null> { return null; },
    };

    const res = await pollPendingPostsJob(pool, mockProvider);
    assert.equal(res.checkedCount, 1);
    assert.equal(res.updatedCount, 1);

    const postCheck = await pool.query(
      "SELECT publish_status, last_polled_at FROM tiktok_posts WHERE run_id = $1",
      [runId]
    );
    assert.equal(postCheck.rows[0].publish_status, "failed");
    assert.ok(postCheck.rows[0].last_polled_at);

    const runCheck = await pool.query(
      "SELECT status, error_message FROM carousel_runs WHERE id = $1",
      [runId]
    );
    assert.equal(runCheck.rows[0].status, "failed");
    assert.ok(runCheck.rows[0].error_message?.includes("Failed at provider level"));
  });

  it("handles 'internal_pending' posts when scheduled_at <= now() by publishing immediately via publishPost", async () => {
    // Add slides to run
    const { runId } = await createTestRunAndPost({
      publishStatus: "internal_pending",
      externalPostId: "temp_internal_id",
      scheduledAt: new Date(Date.now() - 60000), // 1 minute ago
    });

    await pool.query(
      `INSERT INTO carousel_slides (run_id, position, storage_path)
       VALUES ($1, 1, 'slide_1.jpg'),
              ($1, 2, 'slide_2.jpg')`,
      [runId]
    );

    let publishCalledWith: PublishPostRequest | null = null;
    const mockProvider: SocialPublisherProvider = {
      providerName: "buffer",
      async listConnectedAccounts(): Promise<SocialAccount[]> { return []; },
      async publishPost(req: PublishPostRequest): Promise<PublishPostResponse> {
        publishCalledWith = req;
        return {
          externalPostId: "buf_released_123",
          status: "queued",
          rawResponse: { id: "buf_released_123" },
        };
      },
      async getPostStatus(_id: string): Promise<PublishPostResponse> {
        throw new Error("not called");
      },
      async getPostMetrics(_id: string): Promise<PostMetrics | null> { return null; },
    };

    const res = await pollPendingPostsJob(pool, mockProvider);
    assert.ok(publishCalledWith, "provider.publishPost should be called for internal_pending");
    assert.equal((publishCalledWith as PublishPostRequest).publishMode, "immediate");
    assert.equal((publishCalledWith as PublishPostRequest).externalAccountId, "buf_poll_chan_1");
    assert.equal(res.internalPendingReleased, 1);

    const postCheck = await pool.query(
      "SELECT external_post_id, publish_status FROM tiktok_posts WHERE run_id = $1",
      [runId]
    );
    assert.equal(postCheck.rows[0].external_post_id, "buf_released_123");
    assert.equal(postCheck.rows[0].publish_status, "queued");
  });
});
