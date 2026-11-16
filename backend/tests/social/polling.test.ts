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
    process.env.SILO_ACCESS_KEY = "test";
    process.env.SILO_SECRET_KEY = "test";
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
      "TRUNCATE TABLE auto_post_slots, tiktok_posts, dispatch_events, media_usage, carousel_slides, carousel_runs, generation_jobs, media_assets, baits, archetypes, accounts CASCADE;"
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

  async function createTestSlot(options: {
    accountId?: string;
    status?: string;
  } = {}) {
    const res = await pool.query(
      `INSERT INTO auto_post_slots (
        slot_date, window_id, account_id, channel, scheduled_at, window_end, status
      ) VALUES (
        CURRENT_DATE, 'morning', $1, 'zernio', NOW(), NOW() + INTERVAL '2 hours', $2
      ) RETURNING id`,
      [options.accountId || "acc_polling_test", options.status || "done"]
    );
    return res.rows[0].id as string;
  }

  async function createTestRunAndPost(options: {
    runId?: string;
    publishStatus: string;
    externalPostId?: string;
    scheduledAt?: Date | null;
    createdAt?: Date;
    autoPostSlotId?: string | null;
    notifiedAt?: Date | null;
  }) {
    const runRes = await pool.query(
      `INSERT INTO carousel_runs (
        account_id, account_role, archetype_title, bait_body, tema,
        legenda, status, output_dir, generated_at, auto_post_slot_id
      ) VALUES ($1, 'single_woman', 'Archetype Title', 'Bait body', 'Tema teste Polling',
        'Legenda teste', 'generated', '/tmp/dummy', NOW(), $2)
      RETURNING id`,
      ["acc_polling_test", options.autoPostSlotId ?? null]
    );
    const runId = options.runId || runRes.rows[0].id;

    const postRes = await pool.query(
      `INSERT INTO tiktok_posts (
        run_id, tracking_mode, provider, external_post_id, publish_status, scheduled_at, notified_at, created_at, updated_at
      ) VALUES ($1, 'api', 'zernio', $2, $3, $4, $5, COALESCE($6, NOW()), NOW())
      RETURNING id, run_id, publish_status, external_post_id, published_at, notified_at`,
      [
        runId,
        options.externalPostId ?? "ext_post_123",
        options.publishStatus,
        options.scheduledAt ?? null,
        options.notifiedAt ?? null,
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
      providerName: "zernio",
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
      providerName: "zernio",
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
      providerName: "zernio",
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

  describe("Auto slot polling notifications (§5.11 item 28)", () => {
    it("notifies publish_ok and sets notified_at when auto-scheduled post transitions to published", async () => {
      const slotId = await createTestSlot();
      const { runId } = await createTestRunAndPost({
        publishStatus: "queued",
        externalPostId: "ext_post_auto_ok",
        autoPostSlotId: slotId,
      });

      const mockSentAt = new Date().toISOString();
      const mockProvider: SocialPublisherProvider = {
        providerName: "zernio",
        async listConnectedAccounts(): Promise<SocialAccount[]> { return []; },
        async publishPost(_req: PublishPostRequest): Promise<PublishPostResponse> {
          throw new Error("not called");
        },
        async getPostStatus(externalPostId: string): Promise<PublishPostResponse> {
          return {
            externalPostId,
            status: "published",
            publishedAt: mockSentAt,
            rawResponse: { id: externalPostId, status: "sent" },
          };
        },
        async getPostMetrics(_id: string): Promise<PostMetrics | null> { return null; },
      };

      const notifications: Array<{ event: string; payload: any }> = [];
      const notifyFn = async (event: any, payload: any) => {
        notifications.push({ event, payload });
      };

      const res = await (pollPendingPostsJob as any)(pool, mockProvider, { notifyFn });
      assert.equal(res.checkedCount, 1);
      assert.equal(res.updatedCount, 1);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].event, "publish_ok");
      assert.equal(notifications[0].payload.account, "acc_polling_test");
      assert.equal(notifications[0].payload.archetype, "Archetype Title");
      assert.equal(notifications[0].payload.runId, runId);

      const postCheck = await pool.query(
        "SELECT publish_status, notified_at FROM tiktok_posts WHERE run_id = $1",
        [runId]
      );
      assert.equal(postCheck.rows[0].publish_status, "published");
      assert.ok(postCheck.rows[0].notified_at, "notified_at should be populated");
    });

    it("notifies publish_failed and sets notified_at when auto-scheduled post transitions to failed", async () => {
      const slotId = await createTestSlot();
      const { runId } = await createTestRunAndPost({
        publishStatus: "processing",
        externalPostId: "ext_post_auto_fail",
        autoPostSlotId: slotId,
      });

      const mockProvider: SocialPublisherProvider = {
        providerName: "zernio",
        async listConnectedAccounts(): Promise<SocialAccount[]> { return []; },
        async publishPost(_req: PublishPostRequest): Promise<PublishPostResponse> {
          throw new Error("not called");
        },
        async getPostStatus(externalPostId: string): Promise<PublishPostResponse> {
          return {
            externalPostId,
            status: "failed",
            errorMessage: "TikTok account expired",
            rawResponse: { id: externalPostId, error: "expired" },
          };
        },
        async getPostMetrics(_id: string): Promise<PostMetrics | null> { return null; },
      };

      const notifications: Array<{ event: string; payload: any }> = [];
      const notifyFn = async (event: any, payload: any) => {
        notifications.push({ event, payload });
      };

      const res = await (pollPendingPostsJob as any)(pool, mockProvider, { notifyFn });
      assert.equal(res.checkedCount, 1);
      assert.equal(res.updatedCount, 1);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].event, "publish_failed");
      assert.equal(notifications[0].payload.account, "acc_polling_test");
      assert.equal(notifications[0].payload.reason, "TikTok account expired");
      assert.equal(notifications[0].payload.archetype, "Archetype Title");
      assert.equal(notifications[0].payload.runId, runId);

      const postCheck = await pool.query(
        "SELECT publish_status, notified_at FROM tiktok_posts WHERE run_id = $1",
        [runId]
      );
      assert.equal(postCheck.rows[0].publish_status, "failed");
      assert.ok(postCheck.rows[0].notified_at, "notified_at should be populated");
    });

    it("stays silent and leaves notified_at null for manual post (no auto_post_slot_id)", async () => {
      const { runId } = await createTestRunAndPost({
        publishStatus: "queued",
        externalPostId: "ext_post_manual_ok",
        autoPostSlotId: null,
      });

      const mockProvider: SocialPublisherProvider = {
        providerName: "zernio",
        async listConnectedAccounts(): Promise<SocialAccount[]> { return []; },
        async publishPost(_req: PublishPostRequest): Promise<PublishPostResponse> {
          throw new Error("not called");
        },
        async getPostStatus(externalPostId: string): Promise<PublishPostResponse> {
          return {
            externalPostId,
            status: "published",
            publishedAt: new Date().toISOString(),
            rawResponse: { id: externalPostId, status: "sent" },
          };
        },
        async getPostMetrics(_id: string): Promise<PostMetrics | null> { return null; },
      };

      const notifications: Array<{ event: string; payload: any }> = [];
      const notifyFn = async (event: any, payload: any) => {
        notifications.push({ event, payload });
      };

      const res = await (pollPendingPostsJob as any)(pool, mockProvider, { notifyFn });
      assert.equal(res.checkedCount, 1);
      assert.equal(res.updatedCount, 1);

      assert.equal(notifications.length, 0, "no notifications should be sent for manual posts");

      const postCheck = await pool.query(
        "SELECT publish_status, notified_at FROM tiktok_posts WHERE run_id = $1",
        [runId]
      );
      assert.equal(postCheck.rows[0].publish_status, "published");
      assert.equal(postCheck.rows[0].notified_at, null, "notified_at should remain null");
    });

    it("deduplicates notification when notified_at is already set", async () => {
      const slotId = await createTestSlot();
      const existingNotifiedAt = new Date("2026-11-16T10:00:00.000Z");
      const { runId } = await createTestRunAndPost({
        publishStatus: "queued",
        externalPostId: "ext_post_already_notified",
        autoPostSlotId: slotId,
        notifiedAt: existingNotifiedAt,
      });

      const mockProvider: SocialPublisherProvider = {
        providerName: "zernio",
        async listConnectedAccounts(): Promise<SocialAccount[]> { return []; },
        async publishPost(_req: PublishPostRequest): Promise<PublishPostResponse> {
          throw new Error("not called");
        },
        async getPostStatus(externalPostId: string): Promise<PublishPostResponse> {
          return {
            externalPostId,
            status: "published",
            publishedAt: new Date().toISOString(),
            rawResponse: { id: externalPostId, status: "sent" },
          };
        },
        async getPostMetrics(_id: string): Promise<PostMetrics | null> { return null; },
      };

      const notifications: Array<{ event: string; payload: any }> = [];
      const notifyFn = async (event: any, payload: any) => {
        notifications.push({ event, payload });
      };

      const res = await (pollPendingPostsJob as any)(pool, mockProvider, { notifyFn });
      assert.equal(res.checkedCount, 1);
      assert.equal(res.updatedCount, 1);

      assert.equal(notifications.length, 0, "no notification should be sent if already notified");

      const postCheck = await pool.query(
        "SELECT publish_status, notified_at FROM tiktok_posts WHERE run_id = $1",
        [runId]
      );
      assert.equal(postCheck.rows[0].publish_status, "published");
      assert.equal(
        new Date(postCheck.rows[0].notified_at).getTime(),
        existingNotifiedAt.getTime(),
        "notified_at should not be overwritten"
      );
    });
  });
});
