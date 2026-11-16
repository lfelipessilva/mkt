import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  setToken,
  clearToken,
  getSettings,
  updateSetting,
  testDispatch,
  syncTikTok,
  getLatestTikTokSync,
} from "./api";

describe("Task 21: Integrations & Settings API (frontend)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken("dev-token");
  });

  afterEach(() => {
    clearToken();
    globalThis.fetch = originalFetch;
  });

  it("getSettings sends GET /api/v1/settings with token", async () => {
    let requestedUrl = "";
    let authHeader = "";

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      const headers = new Headers(init?.headers);
      authHeader = headers.get("Authorization") || "";
      return new Response(JSON.stringify({ auto_dispatch_enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const settings = await getSettings();
    assert.equal(requestedUrl, "/api/v1/settings");
    assert.equal(authHeader, "Bearer dev-token");
    assert.equal(settings.auto_dispatch_enabled, true);
  });

  it("updateSetting sends PUT /api/v1/settings/:key with json value", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    let bodySent = "";

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestedMethod = init?.method || "GET";
      bodySent = String(init?.body || "");
      return new Response(
        JSON.stringify({ key: "auto_dispatch_enabled", value: false }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    const res = await updateSetting("auto_dispatch_enabled", false);
    assert.equal(requestedUrl, "/api/v1/settings/auto_dispatch_enabled");
    assert.equal(requestedMethod, "PUT");
    assert.deepEqual(JSON.parse(bodySent), { value: false });
    assert.equal(res.value, false);
  });

  it("testDispatch sends POST /api/v1/settings/test-dispatch", async () => {
    let requestedUrl = "";
    let requestedMethod = "";

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestedMethod = init?.method || "GET";
      return new Response(
        JSON.stringify({ ok: true, message: "Disparo enviado" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    const res = await testDispatch();
    assert.equal(requestedUrl, "/api/v1/settings/test-dispatch");
    assert.equal(requestedMethod, "POST");
    assert.equal(res.ok, true);
  });

  it("syncTikTok sends POST /api/v1/tiktok/sync", async () => {
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
          skipped_manual: 1,
          sync_run_id: "sync_456",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    const res = await syncTikTok();
    assert.equal(requestedUrl, "/api/v1/tiktok/sync");
    assert.equal(requestedMethod, "POST");
    assert.equal(res.ok, true);
    assert.equal(res.sync_run_id, "sync_456");
  });

  it("getLatestTikTokSync sends GET /api/v1/tiktok/sync/latest", async () => {
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({
          latest: {
            id: "sync_123",
            started_at: "2026-11-15T18:00:00.000Z",
            posts_updated: 0,
            status: "completed",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    const syncRun = await getLatestTikTokSync();
    assert.equal(requestedUrl, "/api/v1/tiktok/sync/latest");
    assert.ok(syncRun);
    assert.equal(syncRun?.id, "sync_123");
    assert.equal(syncRun?.status, "completed");
  });
});
