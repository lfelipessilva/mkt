import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveGalleryTargetAccountIds,
  executeGalleryGeneration,
} from "./tabs/GalleryPage";
import {
  setToken,
  clearToken,
  generateCarousels,
  pollGenerationJob,
  type GenerationJobProgress,
} from "./api";
import type { Account } from "./types";

describe("GalleryPage: resolveGalleryTargetAccountIds", () => {
  const mockAccounts: Account[] = [
    { id: "acc_1", display_name: "Account One", persona: "P1", role: "single_woman", enabled: true },
    { id: "acc_2", display_name: "Account Two", persona: "P2", role: "single_man", enabled: false },
    { id: "acc_3", display_name: "Account Three", persona: "P3", role: "couple_men", enabled: true },
  ];

  it("returns only the pinned account ID when selectedAccountId is specific and enabled", () => {
    const targets = resolveGalleryTargetAccountIds("acc_1", mockAccounts);
    assert.deepEqual(targets, ["acc_1"]);
  });

  it("returns empty array when pinned account is disabled", () => {
    const targets = resolveGalleryTargetAccountIds("acc_2", mockAccounts);
    assert.deepEqual(targets, []);
  });

  it("returns all enabled account IDs when selectedAccountId is 'all'", () => {
    const targets = resolveGalleryTargetAccountIds("all", mockAccounts);
    assert.deepEqual(targets, ["acc_1", "acc_3"]);
  });

  it("returns empty array when selectedAccountId is 'all' and no accounts are enabled", () => {
    const disabledAccounts: Account[] = [
      { id: "acc_2", persona: "P2", role: "single_man", enabled: false },
    ];
    const targets = resolveGalleryTargetAccountIds("all", disabledAccounts);
    assert.deepEqual(targets, []);
  });
});

describe("GalleryPage: Generation trigger & execution logic", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken("test-token-gallery-gen");
  });

  afterEach(() => {
    clearToken();
    globalThis.fetch = originalFetch;
  });

  const mockAccounts: Account[] = [
    { id: "acc_1", display_name: "Account One", persona: "P1", role: "single_woman", enabled: true },
    { id: "acc_2", display_name: "Account Two", persona: "P2", role: "single_man", enabled: false },
    { id: "acc_3", display_name: "Account Three", persona: "P3", role: "couple_men", enabled: true },
  ];

  it("triggers generation for pinned account with accountIds: [pinnedId] and reloads runs on success", async () => {
    const toasts: { message: string; type: string }[] = [];
    let refreshCalled = false;
    let generatePayload: any = null;
    let polledJobId = "";

    const fakeGenerate = async (input: { accountIds?: string[] }): Promise<GenerationJobProgress> => {
      generatePayload = input;
      return {
        id: "job-pinned-1",
        jobId: "job-pinned-1",
        status: "running",
        account_ids: input.accountIds || [],
        total: 1,
        completed: 0,
        failed: 0,
        runs: [],
      };
    };

    const fakePoll = async (jobId: string): Promise<GenerationJobProgress> => {
      polledJobId = jobId;
      return {
        id: jobId,
        jobId,
        status: "completed",
        account_ids: ["acc_1"],
        total: 1,
        completed: 1,
        failed: 0,
        runs: [],
      };
    };

    const success = await executeGalleryGeneration({
      selectedAccountId: "acc_1",
      accounts: mockAccounts,
      onToast: (message, type) => toasts.push({ message, type }),
      onRefresh: async () => {
        refreshCalled = true;
      },
      generateFn: fakeGenerate,
      pollFn: fakePoll,
    });

    assert.equal(success, true);
    assert.deepEqual(generatePayload, { accountIds: ["acc_1"] });
    assert.equal(polledJobId, "job-pinned-1");
    assert.equal(refreshCalled, true);
    assert.ok(toasts.some((t) => t.type === "info" && t.message.includes("Iniciando")));
    assert.ok(toasts.some((t) => t.type === "success" && t.message.includes("Geração concluída com sucesso!")));
  });

  it("triggers generation for all enabled accounts when context is 'all'", async () => {
    const toasts: { message: string; type: string }[] = [];
    let refreshCalled = false;
    let generatePayload: any = null;

    const fakeGenerate = async (input: { accountIds?: string[] }): Promise<GenerationJobProgress> => {
      generatePayload = input;
      return {
        id: "job-all-1",
        jobId: "job-all-1",
        status: "running",
        account_ids: input.accountIds || [],
        total: 2,
        completed: 0,
        failed: 0,
        runs: [],
      };
    };

    const fakePoll = async (jobId: string): Promise<GenerationJobProgress> => {
      return {
        id: jobId,
        jobId,
        status: "completed",
        account_ids: ["acc_1", "acc_3"],
        total: 2,
        completed: 2,
        failed: 0,
        runs: [],
      };
    };

    const success = await executeGalleryGeneration({
      selectedAccountId: "all",
      accounts: mockAccounts,
      onToast: (message, type) => toasts.push({ message, type }),
      onRefresh: async () => {
        refreshCalled = true;
      },
      generateFn: fakeGenerate,
      pollFn: fakePoll,
    });

    assert.equal(success, true);
    assert.deepEqual(generatePayload, { accountIds: ["acc_1", "acc_3"] });
    assert.equal(refreshCalled, true);
  });

  it("shows warning toast without calling API when no accounts are enabled in 'all' context", async () => {
    const toasts: { message: string; type: string }[] = [];
    let generateCalled = false;
    let refreshCalled = false;

    const disabledAccounts: Account[] = [
      { id: "acc_2", persona: "P2", role: "single_man", enabled: false },
    ];

    const fakeGenerate = async (): Promise<GenerationJobProgress> => {
      generateCalled = true;
      throw new Error("Should not be called");
    };

    const fakePoll = async (): Promise<GenerationJobProgress> => {
      throw new Error("Should not be called");
    };

    const success = await executeGalleryGeneration({
      selectedAccountId: "all",
      accounts: disabledAccounts,
      onToast: (message, type) => toasts.push({ message, type }),
      onRefresh: async () => {
        refreshCalled = true;
      },
      generateFn: fakeGenerate,
      pollFn: fakePoll,
    });

    assert.equal(success, false);
    assert.equal(generateCalled, false);
    assert.equal(refreshCalled, false);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].type, "info");
    assert.equal(toasts[0].message, "Nenhuma conta ativa para gerar carrossel.");
  });

  it("handles generation error gracefully and shows error toast", async () => {
    const toasts: { message: string; type: string }[] = [];
    let refreshCalled = false;

    const failingGenerate = async (): Promise<GenerationJobProgress> => {
      throw new Error("Falha de conexão com o servidor de IA");
    };

    const success = await executeGalleryGeneration({
      selectedAccountId: "acc_1",
      accounts: mockAccounts,
      onToast: (message, type) => toasts.push({ message, type }),
      onRefresh: async () => {
        refreshCalled = true;
      },
      generateFn: failingGenerate,
    });

    assert.equal(success, false);
    assert.equal(refreshCalled, false);
    assert.ok(toasts.some((t) => t.type === "error" && t.message.includes("Falha de conexão com o servidor de IA")));
  });

  it("handles polling failure or failed status gracefully and shows error toast", async () => {
    const toasts: { message: string; type: string }[] = [];
    let refreshCalled = false;

    const fakeGenerate = async (): Promise<GenerationJobProgress> => ({
      id: "job-fail-1",
      jobId: "job-fail-1",
      status: "running",
      account_ids: ["acc_1"],
      total: 1,
      completed: 0,
      failed: 0,
      runs: [],
    });

    const failingPoll = async (): Promise<GenerationJobProgress> => {
      return {
        id: "job-fail-1",
        jobId: "job-fail-1",
        status: "failed",
        account_ids: ["acc_1"],
        total: 1,
        completed: 0,
        failed: 1,
        runs: [],
        error_message: "Quota exceeded",
      };
    };

    const success = await executeGalleryGeneration({
      selectedAccountId: "acc_1",
      accounts: mockAccounts,
      onToast: (message, type) => toasts.push({ message, type }),
      onRefresh: async () => {
        refreshCalled = true;
      },
      generateFn: fakeGenerate,
      pollFn: failingPoll,
    });

    assert.equal(success, false);
    assert.equal(refreshCalled, false);
    assert.ok(toasts.some((t) => t.type === "error" && t.message.includes("Erro ao gerar carrossel")));
  });

  it("handles pollFn rejection/timeout gracefully and shows error toast", async () => {
    const toasts: { message: string; type: string }[] = [];
    let refreshCalled = false;

    const fakeGenerate = async (): Promise<GenerationJobProgress> => ({
      id: "job-timeout-1",
      jobId: "job-timeout-1",
      status: "running",
      account_ids: ["acc_1"],
      total: 1,
      completed: 0,
      failed: 0,
      runs: [],
    });

    const rejectingPoll = async (): Promise<GenerationJobProgress> => {
      throw new Error("Tempo limite de polling excedido para a geração do job job-timeout-1");
    };

    const success = await executeGalleryGeneration({
      selectedAccountId: "acc_1",
      accounts: mockAccounts,
      onToast: (message, type) => toasts.push({ message, type }),
      onRefresh: async () => {
        refreshCalled = true;
      },
      generateFn: fakeGenerate,
      pollFn: rejectingPoll,
    });

    assert.equal(success, false);
    assert.equal(refreshCalled, false);
    assert.ok(toasts.some((t) => t.type === "error" && t.message.includes("Tempo limite de polling excedido")));
  });

  it("shows error toast when all jobs fail upon poll completion", async () => {
    const toasts: { message: string; type: string }[] = [];
    let refreshCalled = false;

    const fakeGenerate = async (): Promise<GenerationJobProgress> => ({
      id: "job-fail-all",
      jobId: "job-fail-all",
      status: "running",
      account_ids: ["acc_1"],
      total: 1,
      completed: 0,
      failed: 0,
      runs: [],
    });

    const allFailedPoll = async (): Promise<GenerationJobProgress> => ({
      id: "job-fail-all",
      jobId: "job-fail-all",
      status: "failed",
      account_ids: ["acc_1"],
      total: 1,
      completed: 0,
      failed: 1,
      runs: [],
      error_message: "Erro interno no modelo",
    });

    const success = await executeGalleryGeneration({
      selectedAccountId: "acc_1",
      accounts: mockAccounts,
      onToast: (message, type) => toasts.push({ message, type }),
      onRefresh: async () => {
        refreshCalled = true;
      },
      generateFn: fakeGenerate,
      pollFn: allFailedPoll,
    });

    assert.equal(success, false);
    assert.equal(refreshCalled, false);
    assert.ok(toasts.some((t) => t.type === "error" && t.message.includes("Erro interno no modelo")));
  });

  it("shows warning toast indicating partial completion when some succeeded and some failed", async () => {
    const toasts: { message: string; type: string }[] = [];
    let refreshCalled = false;

    const fakeGenerate = async (): Promise<GenerationJobProgress> => ({
      id: "job-partial-1",
      jobId: "job-partial-1",
      status: "running",
      account_ids: ["acc_1", "acc_3"],
      total: 2,
      completed: 0,
      failed: 0,
      runs: [],
    });

    const partialPoll = async (): Promise<GenerationJobProgress> => ({
      id: "job-partial-1",
      jobId: "job-partial-1",
      status: "completed",
      account_ids: ["acc_1", "acc_3"],
      total: 2,
      completed: 1,
      failed: 1,
      runs: [],
    });

    const success = await executeGalleryGeneration({
      selectedAccountId: "all",
      accounts: mockAccounts,
      onToast: (message, type) => toasts.push({ message, type }),
      onRefresh: async () => {
        refreshCalled = true;
      },
      generateFn: fakeGenerate,
      pollFn: partialPoll,
    });

    assert.equal(success, true);
    assert.equal(refreshCalled, true);
    assert.ok(toasts.some((t) => t.type === "info" && t.message.includes("1/2")));
  });

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
    assert.ok(requestedUrl.includes("/api/v1/carousels/generate"));
    assert.equal(requestedMethod, "POST");
    assert.deepEqual(requestedBody, { accountIds: ["acc_1"] });
    assert.equal(res.id, "job-123");
  });

  it("pollGenerationJob resolves when job reaches completed", async () => {
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
    assert.ok(progressHistory.length >= 2);
  });
});
