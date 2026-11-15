import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  setToken,
  clearToken,
  getCarouselRuns,
  getCarouselRun,
  dispatchCarouselRun,
  getTikTokPerformance,
  upsertTikTokPost,
  syncTikTok,
} from "./api";
import type {
  CarouselRun,
  CarouselSlide,
  TikTokPerformanceItem,
  UpsertTikTokPostInput,
} from "./types";
import {
  filterRunsByAccount,
  filterRunsByStatus,
  filterRunsBySearch,
  orderSlides,
} from "./tabs/GalleryPage";
import {
  filterPerformanceByAccount,
  sortPerformanceItems,
  computePerformanceStats,
} from "./tabs/PerformancePage";
import { validateManualTikTokInput } from "./components/ManualTikTokModal";

describe("Task 20: Galeria & Desempenho (TDD)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken("test-bearer-token-gallery-perf");
  });

  afterEach(() => {
    clearToken();
    globalThis.fetch = originalFetch;
  });

  describe("Step 1: Gallery & Dispatch API functions", () => {
    it("getCarouselRuns calls GET /api/v1/carousels/runs with query parameters and Authorization", async () => {
      let requestedUrl = "";
      let authHeader = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        authHeader = new Headers(init?.headers).get("Authorization") || "";
        return new Response(
          JSON.stringify([
            {
              id: "run-1",
              account_id: "acc_woman_1",
              account_role: "single_woman",
              archetype_title: "Look monocromático",
              legenda: "Legenda do post",
              status: "generated",
              slides: [
                { id: "s-2", run_id: "run-1", position: 2, storage_path: "slide_2.jpg" },
                { id: "s-1", run_id: "run-1", position: 1, storage_path: "slide_1.jpg" },
              ],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const runs = await getCarouselRuns({
        accountId: "acc_woman_1",
        status: "generated",
        limit: 10,
        offset: 0,
      });

      assert.ok(requestedUrl.includes("/api/v1/carousels/runs"));
      assert.ok(requestedUrl.includes("accountId=acc_woman_1"));
      assert.ok(requestedUrl.includes("status=generated"));
      assert.ok(requestedUrl.includes("limit=10"));
      assert.ok(requestedUrl.includes("offset=0"));
      assert.equal(authHeader, "Bearer test-bearer-token-gallery-perf");
      assert.equal(runs.length, 1);
      assert.equal(runs[0].id, "run-1");
      assert.equal(runs[0].slides?.length, 2);
    });

    it("getCarouselRun calls GET /api/v1/carousels/runs/:id and returns run with slides", async () => {
      let requestedUrl = "";

      globalThis.fetch = (async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            id: "run-42",
            account_id: "acc_man_1",
            account_role: "single_man",
            archetype_title: "Guarda-roupa cápsula",
            legenda: "Legenda masculina",
            status: "generated",
            slides: [
              { id: "s-1", run_id: "run-42", position: 1, storage_path: "slide_1.jpg" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const run = await getCarouselRun("run-42");
      assert.equal(requestedUrl, "/api/v1/carousels/runs/run-42");
      assert.equal(run.id, "run-42");
      assert.equal(run.archetype_title, "Guarda-roupa cápsula");
    });

    it("dispatchCarouselRun calls POST /api/v1/carousels/runs/:id/send with channel (defaults to telegram)", async () => {
      let requestedUrl = "";
      let requestedMethod = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        return new Response(
          JSON.stringify({
            ok: true,
            id: "dispatch-evt-1",
            status: "sent",
            event: { id: "dispatch-evt-1", status: "sent", channel: "telegram" },
            run: { id: "run-1", status: "dispatched" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const result = await dispatchCarouselRun("run-1", "telegram");
      assert.ok(requestedUrl.includes("/api/v1/carousels/runs/run-1/send"));
      assert.ok(requestedUrl.includes("channel=telegram"));
      assert.equal(requestedMethod, "POST");
      assert.equal(result.ok, true);
      assert.equal(result.status, "sent");
      assert.equal(result.run.status, "dispatched");
    });

    it("dispatchCarouselRun supports api channel parameter", async () => {
      let requestedUrl = "";

      globalThis.fetch = (async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            ok: true,
            id: "dispatch-evt-2",
            status: "sent",
            run: { id: "run-2", status: "dispatched" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const result = await dispatchCarouselRun("run-2", "api");
      assert.ok(requestedUrl.includes("channel=api"));
      assert.equal(result.ok, true);
    });
  });

  describe("Step 1: Gallery pure filtering & slide ordering", () => {
    const sampleRuns: CarouselRun[] = [
      {
        id: "run-a",
        account_id: "acc_woman_1",
        account_role: "single_woman",
        archetype_title: "Tendências Verão",
        tema: "Cores vibrantes para praia",
        bait_body: "Qual dessas combina com você?",
        legenda: "Legenda 1",
        status: "generated",
        created_at: "2026-11-15T10:00:00Z",
      },
      {
        id: "run-b",
        account_id: "acc_man_1",
        account_role: "single_man",
        archetype_title: "Alfaiataria Moderna",
        tema: "Blazer com camiseta branca",
        bait_body: "Você usaria?",
        legenda: "Legenda 2",
        status: "dispatched",
        created_at: "2026-11-15T12:00:00Z",
      },
      {
        id: "run-c",
        account_id: "acc_woman_1",
        account_role: "single_woman",
        archetype_title: "Looks Básicos",
        tema: "Peças coringa para o dia a dia",
        bait_body: null,
        legenda: "Legenda 3",
        status: "published",
        created_at: "2026-11-15T14:00:00Z",
      },
    ];

    it("filterRunsByAccount returns all runs when context is 'all'", () => {
      const filtered = filterRunsByAccount(sampleRuns, "all");
      assert.equal(filtered.length, 3);
    });

    it("filterRunsByAccount filters strictly to selected account id", () => {
      const filtered = filterRunsByAccount(sampleRuns, "acc_man_1");
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, "run-b");
    });

    it("filterRunsByStatus filters by status or returns all when 'all'", () => {
      assert.equal(filterRunsByStatus(sampleRuns, "all").length, 3);
      const dispatched = filterRunsByStatus(sampleRuns, "dispatched");
      assert.equal(dispatched.length, 1);
      assert.equal(dispatched[0].id, "run-b");
    });

    it("filterRunsBySearch matches archetype_title, tema, bait or account_id case-insensitively", () => {
      assert.equal(filterRunsBySearch(sampleRuns, "blazer").length, 1);
      assert.equal(filterRunsBySearch(sampleRuns, "verão").length, 1);
      assert.equal(filterRunsBySearch(sampleRuns, "acc_woman").length, 2);
      assert.equal(filterRunsBySearch(sampleRuns, "inexistente").length, 0);
      assert.equal(filterRunsBySearch(sampleRuns, "").length, 3);
    });

    it("orderSlides sorts slides by position ascending", () => {
      const unordered: CarouselSlide[] = [
        { id: "3", run_id: "r1", position: 3, storage_path: "p3.jpg" },
        { id: "1", run_id: "r1", position: 1, storage_path: "p1.jpg" },
        { id: "2", run_id: "r1", position: 2, storage_path: "p2.jpg" },
      ];
      const ordered = orderSlides(unordered);
      assert.deepEqual(
        ordered.map((s) => s.position),
        [1, 2, 3]
      );
    });
  });

  describe("Step 2 & Step 3: TikTok Performance & Manual Publish API", () => {
    it("getTikTokPerformance calls GET /api/v1/tiktok/performance with accountId, sort, and order", async () => {
      let requestedUrl = "";
      let authHeader = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        authHeader = new Headers(init?.headers).get("Authorization") || "";
        return new Response(
          JSON.stringify([
            {
              id: "tp-1",
              tiktok_post_id: "tp-1",
              run_id: "run-1",
              account_id: "acc_woman_1",
              account_role: "single_woman",
              archetype_title: "Tendências",
              legenda: "Legenda",
              status: "published",
              tracking_mode: "manual",
              video_url: "https://tiktok.com/@user/video/111",
              views: 15400,
              likes: 1200,
              comments: 85,
              shares: 42,
              published_at: "2026-11-15T15:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const items = await getTikTokPerformance({
        accountId: "acc_woman_1",
        sort: "views",
        order: "desc",
      });

      assert.ok(requestedUrl.includes("/api/v1/tiktok/performance"));
      assert.ok(requestedUrl.includes("accountId=acc_woman_1"));
      assert.ok(requestedUrl.includes("sort=views"));
      assert.ok(requestedUrl.includes("order=desc"));
      assert.equal(authHeader, "Bearer test-bearer-token-gallery-perf");
      assert.equal(items.length, 1);
      assert.equal(items[0].views, 15400);
    });

    it("upsertTikTokPost calls PUT /api/v1/tiktok/posts/:runId with metrics payload", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody: any = null;

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        requestedBody = JSON.parse(String(init?.body || "{}"));
        return new Response(
          JSON.stringify({
            ok: true,
            post: {
              id: "post-1",
              run_id: "run-10",
              video_url: "https://tiktok.com/@user/video/222",
              views: 5000,
              likes: 450,
              comments: 30,
              shares: 12,
              published_at: "2026-11-15T18:00:00Z",
              tracking_mode: "manual",
            },
            run: {
              id: "run-10",
              status: "published",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const payload: UpsertTikTokPostInput = {
        video_url: "https://tiktok.com/@user/video/222",
        views: 5000,
        likes: 450,
        comments: 30,
        shares: 12,
        published_at: "2026-11-15T18:00:00Z",
        metrics_note: "Post manual verificado",
      };

      const result = await upsertTikTokPost("run-10", payload);
      assert.equal(requestedUrl, "/api/v1/tiktok/posts/run-10");
      assert.equal(requestedMethod, "PUT");
      assert.equal(requestedBody.views, 5000);
      assert.equal(requestedBody.video_url, "https://tiktok.com/@user/video/222");
      assert.equal(result.ok, true);
      assert.equal(result.run.status, "published");
      assert.equal(result.post.views, 5000);
    });

    it("syncTikTok calls POST /api/v1/tiktok/sync stub", async () => {
      let requestedUrl = "";
      let requestedMethod = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        return new Response(
          JSON.stringify({
            ok: true,
            status: "completed",
            posts_updated: 0,
            skipped_manual: 3,
            sync_run_id: "sync-1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const result = await syncTikTok();
      assert.equal(requestedUrl, "/api/v1/tiktok/sync");
      assert.equal(requestedMethod, "POST");
      assert.equal(result.ok, true);
      assert.equal(result.skipped_manual, 3);
    });
  });

  describe("Step 2: Desempenho pure calculations, sorting, and context filtering", () => {
    const mockPerfItems: TikTokPerformanceItem[] = [
      {
        id: "p1",
        tiktok_post_id: "tp1",
        run_id: "r1",
        account_id: "acc_woman_1",
        account_role: "single_woman",
        archetype_title: "Tendências",
        legenda: "Leg 1",
        status: "published",
        tracking_mode: "manual",
        views: 10000,
        likes: 800,
        comments: 50,
        shares: 20,
        published_at: "2026-11-14T10:00:00Z",
        created_at: "2026-11-14T08:00:00Z",
      },
      {
        id: "p2",
        tiktok_post_id: "tp2",
        run_id: "r2",
        account_id: "acc_man_1",
        account_role: "single_man",
        archetype_title: "Minimalismo",
        legenda: "Leg 2",
        status: "published",
        tracking_mode: "manual",
        views: 25000,
        likes: 2100,
        comments: 140,
        shares: 90,
        published_at: "2026-11-15T12:00:00Z",
        created_at: "2026-11-15T09:00:00Z",
      },
      {
        id: "p3",
        tiktok_post_id: "tp3",
        run_id: "r3",
        account_id: "acc_woman_1",
        account_role: "single_woman",
        archetype_title: "Acessórios",
        legenda: "Leg 3",
        status: "published",
        tracking_mode: "manual",
        views: 5000,
        likes: 300,
        comments: 20,
        shares: 10,
        published_at: "2026-11-13T10:00:00Z",
        created_at: "2026-11-13T07:00:00Z",
      },
    ];

    it("filterPerformanceByAccount filters by context account id", () => {
      assert.equal(filterPerformanceByAccount(mockPerfItems, "all").length, 3);
      const filtered = filterPerformanceByAccount(mockPerfItems, "acc_man_1");
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, "p2");
    });

    it("sortPerformanceItems sorts by views descending by default", () => {
      const sorted = sortPerformanceItems(mockPerfItems, "views", "desc");
      assert.deepEqual(
        sorted.map((item) => item.views),
        [25000, 10000, 5000]
      );
    });

    it("sortPerformanceItems sorts by views ascending", () => {
      const sorted = sortPerformanceItems(mockPerfItems, "views", "asc");
      assert.deepEqual(
        sorted.map((item) => item.views),
        [5000, 10000, 25000]
      );
    });

    it("sortPerformanceItems sorts by published_at date", () => {
      const sortedDesc = sortPerformanceItems(mockPerfItems, "published_at", "desc");
      assert.equal(sortedDesc[0].id, "p2"); // 2026-11-15
      assert.equal(sortedDesc[2].id, "p3"); // 2026-11-13
    });

    it("computePerformanceStats aggregates metrics correctly", () => {
      const stats = computePerformanceStats(mockPerfItems);
      assert.equal(stats.totalPosts, 3);
      assert.equal(stats.totalViews, 40000);
      assert.equal(stats.totalLikes, 3200);
      assert.equal(stats.totalComments, 210);
      assert.equal(stats.totalShares, 120);
      assert.equal(stats.avgViewsPerPost, Math.round(40000 / 3));
    });

    it("computePerformanceStats handles empty array safely", () => {
      const stats = computePerformanceStats([]);
      assert.equal(stats.totalPosts, 0);
      assert.equal(stats.totalViews, 0);
      assert.equal(stats.totalLikes, 0);
      assert.equal(stats.avgViewsPerPost, 0);
    });
  });

  describe("Step 3: Manual TikTok Publish input validation", () => {
    it("validates that metric values cannot be negative", () => {
      const invalid = validateManualTikTokInput({
        views: -10,
        likes: 5,
      });
      assert.equal(invalid.valid, false);
      assert.match(invalid.error || "", /não pode ser negativo/i);
    });

    it("validates valid input with default metrics", () => {
      const valid = validateManualTikTokInput({
        views: 1200,
        likes: 100,
        comments: 15,
        shares: 4,
        video_url: "https://www.tiktok.com/@user/video/1234567890",
      });
      assert.equal(valid.valid, true);
    });

    it("accepts zero metrics and empty video_url", () => {
      const valid = validateManualTikTokInput({
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        video_url: "",
      });
      assert.equal(valid.valid, true);
    });
  });
});
