import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { syncTikTokMetricsDailyJob } from "../../src/domain/social/metricsSync.js";
import type { SocialPublisherProvider, PublishPostRequest, PublishPostResponse, PostMetrics, SocialAccount } from "../../src/domain/social/types.js";

const { Pool } = pg;

describe("Task 6: Daily Metrics Sync Worker (syncTikTokMetricsDailyJob)", { timeout: 60000 }, () => {
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
    await pool.query(
      "TRUNCATE TABLE tiktok_sync_runs, tiktok_metrics, tiktok_posts, dispatch_events, media_usage, carousel_slides, carousel_runs, generation_jobs, media_assets, baits, archetypes, accounts CASCADE;"
    );

    await pool.query(
      `INSERT INTO accounts (id, persona, role, enabled, external_account_id, social_provider)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["acc_metrics_test", "Conta Metrics Teste", "single_woman", true, "buf_met_chan_1", "buffer"]
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

  async function createPublishedPost(options: {
    externalPostId: string;
    publishedAt: Date;
    views?: number;
    likes?: number;
  }) {
    const runRes = await pool.query(
      `INSERT INTO carousel_runs (
        account_id, account_role, archetype_title, bait_body, tema,
        legenda, status, output_dir, generated_at
      ) VALUES ($1, 'single_woman', 'Archetype Title', 'Bait body', 'Tema teste Metrics',
        'Legenda teste', 'published', '/tmp/dummy', NOW())
      RETURNING id`,
      ["acc_metrics_test"]
    );
    const runId = runRes.rows[0].id;

    const postRes = await pool.query(
      `INSERT INTO tiktok_posts (
        run_id, tracking_mode, provider, external_post_id, publish_status,
        published_at, views, likes, comments, shares, created_at, updated_at
      ) VALUES ($1, 'api', 'zernio', $2, 'published', $3, $4, $5, 0, 0, NOW(), NOW())
      RETURNING id, run_id, external_post_id`,
      [
        runId,
        options.externalPostId,
        options.publishedAt,
        options.views ?? 0,
        options.likes ?? 0,
      ]
    );

    return { runId, postId: postRes.rows[0].id };
  }

  it("iterates published posts < 30 days old with external_post_id, updates metrics and inserts into tiktok_metrics", async () => {
    const publishedRecent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days old
    const { postId } = await createPublishedPost({
      externalPostId: "ext_buf_recent",
      publishedAt: publishedRecent,
      views: 10,
      likes: 1,
    });

    const mockProvider: SocialPublisherProvider = {
      providerName: "zernio",
      async listConnectedAccounts(): Promise<SocialAccount[]> { return []; },
      async publishPost(_req: PublishPostRequest): Promise<PublishPostResponse> {
        throw new Error("not called");
      },
      async getPostStatus(_id: string): Promise<PublishPostResponse> {
        throw new Error("not called");
      },
      async getPostMetrics(externalPostId: string): Promise<PostMetrics | null> {
        assert.equal(externalPostId, "ext_buf_recent");
        return {
          externalPostId,
          views: 1500,
          likes: 320,
          comments: 45,
          shares: 12,
          collectedAt: new Date().toISOString(),
        };
      },
    };

    const res = await syncTikTokMetricsDailyJob(pool, mockProvider);
    assert.equal(res.postsUpdated, 1);

    // Verify tiktok_posts updated
    const postCheck = await pool.query(
      "SELECT views, likes, comments, shares FROM tiktok_posts WHERE id = $1",
      [postId]
    );
    assert.equal(Number(postCheck.rows[0].views), 1500);
    assert.equal(Number(postCheck.rows[0].likes), 320);
    assert.equal(Number(postCheck.rows[0].comments), 45);
    assert.equal(Number(postCheck.rows[0].shares), 12);

    // Verify tiktok_metrics record inserted
    const metricsCheck = await pool.query(
      "SELECT tiktok_post_id, views, likes, comments, shares FROM tiktok_metrics WHERE tiktok_post_id = $1",
      [postId]
    );
    assert.equal(metricsCheck.rows.length, 1);
    assert.equal(Number(metricsCheck.rows[0].views), 1500);

    // Verify tiktok_sync_runs recorded
    const syncRunCheck = await pool.query(
      "SELECT posts_updated, status FROM tiktok_sync_runs ORDER BY started_at DESC LIMIT 1"
    );
    assert.equal(syncRunCheck.rows.length, 1);
    assert.equal(syncRunCheck.rows[0].status, "completed");
    assert.equal(syncRunCheck.rows[0].posts_updated, 1);
  });

  it("skips posts published more than 30 days ago", async () => {
    const publishedOld = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days old
    await createPublishedPost({
      externalPostId: "ext_buf_old",
      publishedAt: publishedOld,
    });

    let getMetricsCalled = false;
    const mockProvider: SocialPublisherProvider = {
      providerName: "zernio",
      async listConnectedAccounts(): Promise<SocialAccount[]> { return []; },
      async publishPost(_req: PublishPostRequest): Promise<PublishPostResponse> {
        throw new Error("not called");
      },
      async getPostStatus(_id: string): Promise<PublishPostResponse> {
        throw new Error("not called");
      },
      async getPostMetrics(_externalPostId: string): Promise<PostMetrics | null> {
        getMetricsCalled = true;
        return null;
      },
    };

    const res = await syncTikTokMetricsDailyJob(pool, mockProvider);
    assert.equal(res.postsUpdated, 0);
    assert.equal(getMetricsCalled, false, "Should not query metrics for posts older than 30 days");
  });
});
