import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  generateCarousels,
  getGenerationJob,
  pollGenerationJob,
  type GenerationJobProgress,
} from "./api";
import { setToken, clearToken } from "./api";
import {
  resolveTargetAccountIds,
} from "./tabs/GeneratePage";
import type { Account } from "./types";

describe("GeneratePage logic & API", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken("test-token-generate");
  });

  afterEach(() => {
    clearToken();
    globalThis.fetch = originalFetch;
  });

  const mockAccounts: Account[] = [
    {
      id: "acc_1",
      display_name: "Account One",
      persona: "P1",
      role: "single_woman",
      enabled: true,
    },
    {
      id: "acc_2",
      display_name: "Account Two",
      persona: "P2",
      role: "single_man",
      enabled: false,
    },
    {
      id: "acc_3",
      display_name: "Account Three",
      persona: "P3",
      role: "couple_men",
      enabled: true,
    },
  ];

  describe("Account selection & target resolving", () => {
    it("resolves all enabled accounts when mode is 'all_enabled'", () => {
      const selected = resolveTargetAccountIds(
        "all_enabled",
        mockAccounts,
        ["acc_2"] // even if custom selection exists
      );
      assert.deepEqual(selected, ["acc_1", "acc_3"]);
    });

    it("resolves custom selected accounts filtered to enabled when mode is 'custom'", () => {
      const selected = resolveTargetAccountIds(
        "custom",
        mockAccounts,
        ["acc_1", "acc_2"] // acc_2 is disabled
      );
      assert.deepEqual(selected, ["acc_1"]);
    });

    it("returns empty array if no accounts selected or none enabled in custom mode", () => {
      const selected = resolveTargetAccountIds("custom", mockAccounts, ["acc_2"]);
      assert.deepEqual(selected, []);
    });
  });

  describe("Generate API calls", () => {
    it("generateCarousels calls POST /api/v1/carousels/generate with accountIds", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody: any = null;

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        requestedBody = init?.body ? JSON.parse(String(init.body)) : null;

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "job-123",
            jobId: "job-123",
            status: "running",
            account_ids: ["acc_1"],
            total: 1,
            completed: 0,
            failed: 0,
            runs: [],
          }),
        } as unknown as Response;
      }) as typeof fetch;

      const res = await generateCarousels({ accountIds: ["acc_1"] });
      assert.equal(requestedUrl, "/api/v1/carousels/generate");
      assert.equal(requestedMethod, "POST");
      assert.deepEqual(requestedBody, { accountIds: ["acc_1"] });
      assert.equal(res.id, "job-123");
      assert.equal(res.status, "running");
    });

    it("getGenerationJob calls GET /api/v1/carousels/jobs/:id", async () => {
      let requestedUrl = "";

      globalThis.fetch = (async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "job-123",
            jobId: "job-123",
            status: "completed",
            account_ids: ["acc_1"],
            total: 1,
            completed: 1,
            failed: 0,
            runs: [
              {
                id: "run-1",
                account_id: "acc_1",
                status: "generated",
              },
            ],
          }),
        } as unknown as Response;
      }) as typeof fetch;

      const res = await getGenerationJob("job-123");
      assert.equal(requestedUrl, "/api/v1/carousels/jobs/job-123");
      assert.equal(res.status, "completed");
      assert.equal(res.completed, 1);
    });

    it("pollGenerationJob resolves when job reaches completed or failed", async () => {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        const status = calls >= 2 ? "completed" : "running";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "job-123",
            jobId: "job-123",
            status,
            account_ids: ["acc_1"],
            total: 1,
            completed: calls >= 2 ? 1 : 0,
            failed: 0,
            runs: [],
          }),
        } as unknown as Response;
      }) as typeof fetch;

      const progressHistory: GenerationJobProgress[] = [];
      const result = await pollGenerationJob("job-123", {
        intervalMs: 10,
        maxAttempts: 5,
        onProgress: (p) => progressHistory.push(p),
      });

      assert.equal(result.status, "completed");
      assert.equal(progressHistory.length >= 2, true);
    });
  });
});
