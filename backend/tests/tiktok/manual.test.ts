import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { createCarouselRun, getCarouselRun } from "../../src/domain/runs/store.js";
import {
  upsertTikTokPost,
  getTikTokPostByRunId,
  listTikTokPerformance,
  runTikTokSyncStub,
} from "../../src/domain/tiktok/store.js";

const { Pool } = pg;

describe("Task 16: TikTok manual publish & Desempenho query", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;

  const testToken = "test-secret-token-tiktok";
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

  after(async () => {
    await app.close();
    await pool.end();
    if (container) {
      await container.stop();
    }
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE TABLE tiktok_sync_runs, tiktok_metrics, tiktok_posts, dispatch_events, media_usage, carousel_slides, carousel_runs, generation_jobs, media_assets, baits, archetypes, accounts CASCADE;"
    );

    // Seed test accounts
    await upsertAccount({
      id: "acc_female",
      display_name: "Female Account",
      persona: "Female Creator",
      role: "single_woman",
      enabled: true,
    });

    await upsertAccount({
      id: "acc_male",
      display_name: "Male Account",
      persona: "Male Creator",
      role: "single_man",
      enabled: true,
    });
  });

  describe("Authentication", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const resPut = await app.inject({
        method: "PUT",
        url: "/api/v1/tiktok/posts/11111111-1111-1111-1111-111111111111",
        payload: { video_url: "https://tiktok.com/@test/video/1" },
      });
      assert.equal(resPut.statusCode, 401);

      const resPerf = await app.inject({
        method: "GET",
        url: "/api/v1/tiktok/performance",
      });
      assert.equal(resPerf.statusCode, 401);

      const resSync = await app.inject({
        method: "POST",
        url: "/api/v1/tiktok/sync",
      });
      assert.equal(resSync.statusCode, 401);
    });
  });

  describe("Step 1: Test manual upsert then performance list sorts by views", () => {
    it("returns 404 when upserting for a non-existent runId", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/tiktok/posts/00000000-0000-0000-0000-000000000000",
        headers: authHeaders,
        payload: {
          video_url: "https://tiktok.com/@creator/video/123",
          views: 1500,
        },
      });

      assert.equal(res.statusCode, 404);
      const body = res.json();
      assert.equal(body.error, "not_found");
    });

    it("upserts manual metrics for a run, creates tiktok_posts row with tracking_mode = manual", async () => {
      const run = await createCarouselRun({
        account_id: "acc_female",
        account_role: "single_woman",
        archetype_title: "Top 5 Dicas",
        tema: "Autoestima Feminina",
        legenda: "Legenda de teste",
        status: "generated",
      });

      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${run.id}`,
        headers: authHeaders,
        payload: {
          video_url: "https://www.tiktok.com/@creator/video/987654321",
          views: 12500,
          likes: 850,
          comments: 42,
          shares: 18,
          metrics_note: "Bom engajamento nos comentários",
        },
      });

      assert.equal(res.statusCode, 200);
      const post = res.json();
      assert.equal(post.run_id, run.id);
      assert.equal(post.tracking_mode, "manual");
      assert.equal(post.video_url, "https://www.tiktok.com/@creator/video/987654321");
      assert.equal(post.views, 12500);
      assert.equal(post.likes, 850);
      assert.equal(post.comments, 42);
      assert.equal(post.shares, 18);
      assert.equal(post.metrics_note, "Bom engajamento nos comentários");
      assert.ok(post.published_at, "published_at should be set");

      // Verify in DB directly via store
      const dbPost = await getTikTokPostByRunId(run.id);
      assert.ok(dbPost);
      assert.equal(dbPost?.run_id, run.id);
      assert.equal(dbPost?.views, 12500);
      assert.equal(dbPost?.tracking_mode, "manual");
    });

    it("is idempotent: subsequent PUT on same runId updates metrics without duplicating rows", async () => {
      const run = await createCarouselRun({
        account_id: "acc_male",
        account_role: "single_man",
        archetype_title: "Treino Masculino",
        legenda: "Legenda treino",
        status: "generated",
      });

      // First upsert
      const res1 = await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${run.id}`,
        headers: authHeaders,
        payload: {
          video_url: "https://tiktok.com/@male/video/1",
          views: 100,
          likes: 10,
        },
      });
      assert.equal(res1.statusCode, 200);

      // Second upsert updating metrics
      const res2 = await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${run.id}`,
        headers: authHeaders,
        payload: {
          video_url: "https://tiktok.com/@male/video/1-updated",
          views: 5000,
          likes: 450,
          comments: 25,
          shares: 12,
        },
      });
      assert.equal(res2.statusCode, 200);
      const updated = res2.json();
      assert.equal(updated.views, 5000);
      assert.equal(updated.likes, 450);
      assert.equal(updated.video_url, "https://tiktok.com/@male/video/1-updated");

      // Check total rows in tiktok_posts table is still 1
      const countRes = await pool.query("SELECT COUNT(*) AS count FROM tiktok_posts WHERE run_id = $1", [run.id]);
      assert.equal(parseInt(countRes.rows[0].count, 10), 1);
    });

    it("GET /api/v1/tiktok/performance returns joined runs + tiktok_posts sorted by views descending", async () => {
      const run1 = await createCarouselRun({
        account_id: "acc_female",
        account_role: "single_woman",
        archetype_title: "Post Baixo",
        tema: "Tema 1",
        legenda: "Legenda 1",
        status: "generated",
      });

      const run2 = await createCarouselRun({
        account_id: "acc_female",
        account_role: "single_woman",
        archetype_title: "Post Médio",
        tema: "Tema 2",
        legenda: "Legenda 2",
        status: "generated",
      });

      const run3 = await createCarouselRun({
        account_id: "acc_male",
        account_role: "single_man",
        archetype_title: "Post Viral",
        tema: "Tema 3",
        legenda: "Legenda 3",
        status: "generated",
      });

      // Upsert metrics with different views
      await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${run1.id}`,
        headers: authHeaders,
        payload: { video_url: "https://tiktok.com/1", views: 500, likes: 20 },
      });

      await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${run2.id}`,
        headers: authHeaders,
        payload: { video_url: "https://tiktok.com/2", views: 25000, likes: 1200 },
      });

      await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${run3.id}`,
        headers: authHeaders,
        payload: { video_url: "https://tiktok.com/3", views: 100000, likes: 8000 },
      });

      // Query performance default sort (sort=views)
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/tiktok/performance?sort=views",
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const list = res.json();
      assert.equal(list.length, 3);

      // Verify order by views descending: 100000 -> 25000 -> 500
      assert.equal(list[0].views, 100000);
      assert.equal(list[0].run_id, run3.id);
      assert.equal(list[0].account_id, "acc_male");
      assert.equal(list[0].archetype_title, "Post Viral");

      assert.equal(list[1].views, 25000);
      assert.equal(list[1].run_id, run2.id);
      assert.equal(list[1].account_id, "acc_female");
      assert.equal(list[1].archetype_title, "Post Médio");

      assert.equal(list[2].views, 500);
      assert.equal(list[2].run_id, run1.id);
      assert.equal(list[2].account_id, "acc_female");
      assert.equal(list[2].archetype_title, "Post Baixo");
    });

    it("GET /api/v1/tiktok/performance filters by accountId", async () => {
      const runF = await createCarouselRun({
        account_id: "acc_female",
        account_role: "single_woman",
        archetype_title: "Post F",
        legenda: "Legenda F",
        status: "generated",
      });

      const runM = await createCarouselRun({
        account_id: "acc_male",
        account_role: "single_man",
        archetype_title: "Post M",
        legenda: "Legenda M",
        status: "generated",
      });

      await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${runF.id}`,
        headers: authHeaders,
        payload: { video_url: "https://tiktok.com/f", views: 1000 },
      });

      await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${runM.id}`,
        headers: authHeaders,
        payload: { video_url: "https://tiktok.com/m", views: 2000 },
      });

      // Filter by acc_female
      const resF = await app.inject({
        method: "GET",
        url: "/api/v1/tiktok/performance?accountId=acc_female",
        headers: authHeaders,
      });

      assert.equal(resF.statusCode, 200);
      const listF = resF.json();
      assert.equal(listF.length, 1);
      assert.equal(listF[0].account_id, "acc_female");
      assert.equal(listF[0].run_id, runF.id);

      // Filter by acc_male
      const resM = await app.inject({
        method: "GET",
        url: "/api/v1/tiktok/performance?accountId=acc_male",
        headers: authHeaders,
      });

      assert.equal(resM.statusCode, 200);
      const listM = resM.json();
      assert.equal(listM.length, 1);
      assert.equal(listM[0].account_id, "acc_male");
      assert.equal(listM[0].run_id, runM.id);
    });
  });

  describe("Step 2: Mark run status = published when manual publish saved (optional published_at set)", () => {
    it("marks carousel_runs status = 'published' when manual publish is saved", async () => {
      const run = await createCarouselRun({
        account_id: "acc_female",
        account_role: "single_woman",
        archetype_title: "Look de Trabalho",
        legenda: "Legenda look",
        status: "generated",
      });

      assert.equal(run.status, "generated");

      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${run.id}`,
        headers: authHeaders,
        payload: {
          video_url: "https://tiktok.com/@female/worklook",
          views: 340,
        },
      });

      assert.equal(res.statusCode, 200);

      // Verify in DB that run status is updated to 'published'
      const updatedRun = await getCarouselRun(run.id);
      assert.ok(updatedRun);
      assert.equal(updatedRun?.status, "published");
    });

    it("respects custom published_at when passed, and defaults to current time if omitted", async () => {
      const customDate = new Date("2026-11-10T15:30:00.000Z");

      const runWithCustomDate = await createCarouselRun({
        account_id: "acc_female",
        account_role: "single_woman",
        archetype_title: "Post Passado",
        legenda: "Legenda",
        status: "generated",
      });

      const resCustom = await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${runWithCustomDate.id}`,
        headers: authHeaders,
        payload: {
          video_url: "https://tiktok.com/custom-date",
          published_at: customDate.toISOString(),
          views: 120,
        },
      });

      assert.equal(resCustom.statusCode, 200);
      const postCustom = resCustom.json();
      assert.equal(
        new Date(postCustom.published_at).toISOString(),
        customDate.toISOString()
      );

      // Run with omitted published_at
      const runWithDefaultDate = await createCarouselRun({
        account_id: "acc_male",
        account_role: "single_man",
        archetype_title: "Post Hoje",
        legenda: "Legenda",
        status: "generated",
      });

      const beforeTime = Date.now() - 2000;
      const resDefault = await app.inject({
        method: "PUT",
        url: `/api/v1/tiktok/posts/${runWithDefaultDate.id}`,
        headers: authHeaders,
        payload: {
          video_url: "https://tiktok.com/default-date",
          views: 450,
        },
      });

      assert.equal(resDefault.statusCode, 200);
      const postDefault = resDefault.json();
      assert.ok(postDefault.published_at);
      const defaultTime = new Date(postDefault.published_at).getTime();
      assert.ok(defaultTime >= beforeTime, "published_at should be approximately now");
    });
  });

  describe("Stub POST /api/v1/tiktok/sync", () => {
    it("is a no-op that skips manual posts and logs a completed sync run", async () => {
      const run = await createCarouselRun({
        account_id: "acc_female",
        account_role: "single_woman",
        archetype_title: "Manual Post Test",
        legenda: "Legenda",
        status: "generated",
      });

      // Save a manual post
      await upsertTikTokPost(run.id, {
        video_url: "https://tiktok.com/manual-test",
        views: 777,
        likes: 88,
        tracking_mode: "manual",
      });

      const postBefore = await getTikTokPostByRunId(run.id);
      assert.ok(postBefore);
      assert.equal(postBefore?.views, 777);

      // Trigger sync stub
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/tiktok/sync",
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.ok, true);
      assert.equal(body.posts_updated, 0);
      assert.equal(body.skipped_manual, 1);
      assert.ok(body.sync_run_id);

      // Ensure manual post was not modified
      const postAfter = await getTikTokPostByRunId(run.id);
      assert.equal(postAfter?.views, 777);
      assert.equal(postAfter?.tracking_mode, "manual");

      // Verify row in tiktok_sync_runs
      const syncRunRes = await pool.query("SELECT * FROM tiktok_sync_runs WHERE id = $1", [body.sync_run_id]);
      assert.equal(syncRunRes.rows.length, 1);
      assert.equal(syncRunRes.rows[0].status, "completed");
      assert.equal(syncRunRes.rows[0].posts_updated, 0);
    });
  });

  describe("Direct store functions", () => {
    it("supports direct store operations: upsert, get, list, sync stub", async () => {
      const run = await createCarouselRun({
        account_id: "acc_male",
        account_role: "single_man",
        archetype_title: "Store Function Run",
        legenda: "Store legenda",
        status: "generated",
      });

      const { post, run: updatedRun } = await upsertTikTokPost(run.id, {
        video_url: "https://tiktok.com/direct-store",
        views: 9999,
        likes: 111,
      });

      assert.equal(post.run_id, run.id);
      assert.equal(post.views, 9999);
      assert.equal(updatedRun.status, "published");

      const fetched = await getTikTokPostByRunId(run.id);
      assert.equal(fetched?.id, post.id);

      const perf = await listTikTokPerformance({ accountId: "acc_male" });
      assert.equal(perf.length, 1);
      assert.equal(perf[0].views, 9999);

      const syncResult = await runTikTokSyncStub();
      assert.equal(syncResult.ok, true);
      assert.equal(syncResult.posts_updated, 0);
    });
  });
});
