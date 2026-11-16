import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  setToken,
  clearToken,
  dispatchCarouselRun,
  approveAutomationRun,
} from "./api";
import { resolveBufferPublishState } from "./components/RunCard";
import type { Account, CarouselRun } from "./types";

describe("Task 11: Frontend Buffer button + API channel (TDD)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken("test-token-task-11");
  });

  afterEach(() => {
    clearToken();
    globalThis.fetch = originalFetch;
  });

  const linkedAccount: Account = {
    id: "acc_linked",
    display_name: "Conta Vinculada",
    persona: "persona 1",
    role: "single_woman",
    enabled: true,
    social_provider: "buffer",
    external_account_id: "buf_channel_123",
  };

  const unlinkedAccount: Account = {
    id: "acc_unlinked",
    display_name: "Conta Sem Vínculo",
    persona: "persona 2",
    role: "single_man",
    enabled: true,
    social_provider: null,
    external_account_id: null,
  };

  const baseRun: CarouselRun = {
    id: "run-test-1",
    account_id: "acc_linked",
    account_role: "single_woman",
    archetype_title: "Look monocromático",
    legenda: "Legenda teste",
    status: "generated",
    buffer_dispatched_at: null,
  };

  describe("resolveBufferPublishState (spec §5.9.1 / frontend tests 1–4, 8, 10)", () => {
    // 1. resolveBufferPublishState: conta vinculada + run sem envio → botão visível/habilitado com “Publicar no Buffer”.
    it("1. resolveBufferPublishState: conta vinculada + run sem envio → botão visível/habilitado com 'Publicar no Buffer'", () => {
      const state = resolveBufferPublishState(linkedAccount, {
        ...baseRun,
        status: "generated",
        buffer_dispatched_at: null,
      });
      assert.deepEqual(state, {
        visible: true,
        disabled: false,
        label: "Publicar no Buffer",
      });
    });

    // 2. Conta sem vínculo → invisível.
    it("2. Conta sem vínculo → invisível", () => {
      const state1 = resolveBufferPublishState(unlinkedAccount, {
        ...baseRun,
        account_id: unlinkedAccount.id,
        status: "generated",
        buffer_dispatched_at: null,
      });
      assert.equal(state1.visible, false);

      const state2 = resolveBufferPublishState(null, {
        ...baseRun,
        status: "generated",
        buffer_dispatched_at: null,
      });
      assert.equal(state2.visible, false);

      const state3 = resolveBufferPublishState(undefined, {
        ...baseRun,
        status: "generated",
        buffer_dispatched_at: null,
      });
      assert.equal(state3.visible, false);

      const emptyExtAccount: Account = {
        ...unlinkedAccount,
        external_account_id: "",
      };
      const state4 = resolveBufferPublishState(emptyExtAccount, {
        ...baseRun,
        status: "generated",
        buffer_dispatched_at: null,
      });
      assert.equal(state4.visible, false);

      const nonBufferAccount: Account = {
        ...linkedAccount,
        social_provider: "postforme",
        external_account_id: "pf_123",
      };
      const state5 = resolveBufferPublishState(nonBufferAccount, {
        ...baseRun,
        status: "generated",
        buffer_dispatched_at: null,
      });
      assert.equal(state5.visible, false);
    });

    // 3. buffer_dispatched_at presente → “Enviado ao Buffer” desabilitado.
    it("3. buffer_dispatched_at presente → 'Enviado ao Buffer' desabilitado", () => {
      const state = resolveBufferPublishState(linkedAccount, {
        ...baseRun,
        status: "dispatched",
        buffer_dispatched_at: "2026-11-16T12:00:00.000Z",
      });
      assert.deepEqual(state, {
        visible: true,
        disabled: true,
        label: "Enviado ao Buffer",
      });
    });

    // 4. buffer_dispatched_at presente + run.status = 'failed' → “Reenviar ao Buffer” habilitado.
    it("4. buffer_dispatched_at presente + run.status = 'failed' → 'Reenviar ao Buffer' habilitado", () => {
      const state = resolveBufferPublishState(linkedAccount, {
        ...baseRun,
        status: "failed",
        buffer_dispatched_at: "2026-11-16T12:00:00.000Z",
      });
      assert.deepEqual(state, {
        visible: true,
        disabled: false,
        label: "Reenviar ao Buffer",
      });
    });

    // 8. resolveBufferPublishState: run.status='published' sem buffer_dispatched_at → visível, desabilitado, “Já publicado”.
    it("8. resolveBufferPublishState: run.status='published' sem buffer_dispatched_at → visível, desabilitado, 'Já publicado'", () => {
      const state = resolveBufferPublishState(linkedAccount, {
        ...baseRun,
        status: "published",
        buffer_dispatched_at: null,
      });
      assert.deepEqual(state, {
        visible: true,
        disabled: true,
        label: "Já publicado",
      });
    });

    // 10. resolveBufferPublishState: run status='awaiting_approval' → visível, habilitado, 'Confirmar envio'.
    it("10. resolveBufferPublishState: run status='awaiting_approval' → visível, habilitado, 'Confirmar envio'", () => {
      const state = resolveBufferPublishState(linkedAccount, {
        ...baseRun,
        status: "awaiting_approval",
        buffer_dispatched_at: null,
      });
      assert.deepEqual(state, {
        visible: true,
        disabled: false,
        label: "Confirmar envio",
      });
    });
  });

  describe("API channel buffer|social and approveAutomationRun (spec §5.9.1 / frontend test 5)", () => {
    // 5. dispatchCarouselRun(id, 'buffer') chama POST /api/v1/carousels/runs/:id/send?channel=buffer.
    it("5. dispatchCarouselRun(id, 'buffer') chama POST /api/v1/carousels/runs/:id/send?channel=buffer", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let authHeader = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        authHeader = new Headers(init?.headers).get("Authorization") || "";
        return new Response(
          JSON.stringify({
            ok: true,
            id: "dispatch-evt-buffer-1",
            status: "sent",
            event: { id: "dispatch-evt-buffer-1", channel: "buffer", status: "sent" },
            run: {
              ...baseRun,
              status: "dispatched",
              buffer_dispatched_at: "2026-11-16T12:30:00.000Z",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const result = await dispatchCarouselRun("run-test-1", "buffer");
      assert.ok(requestedUrl.includes("/api/v1/carousels/runs/run-test-1/send"));
      assert.ok(requestedUrl.includes("channel=buffer"));
      assert.equal(requestedMethod, "POST");
      assert.equal(authHeader, "Bearer test-token-task-11");
      assert.equal(result.ok, true);
      assert.equal(result.status, "sent");
      assert.equal(result.run.buffer_dispatched_at, "2026-11-16T12:30:00.000Z");
    });

    it("dispatchCarouselRun(id, 'social') calls POST /api/v1/carousels/runs/:id/send?channel=social", async () => {
      let requestedUrl = "";
      let requestedMethod = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        return new Response(
          JSON.stringify({
            ok: true,
            id: "dispatch-evt-social-1",
            status: "sent",
            event: { id: "dispatch-evt-social-1", channel: "social", status: "sent" },
            run: { ...baseRun, status: "dispatched" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const result = await dispatchCarouselRun("run-test-1", "social");
      assert.ok(requestedUrl.includes("channel=social"));
      assert.equal(requestedMethod, "POST");
      assert.equal(result.ok, true);
    });

    it("approveAutomationRun calls POST /api/v1/automation/runs/:id/approve", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let authHeader = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        authHeader = new Headers(init?.headers).get("Authorization") || "";
        return new Response(
          JSON.stringify({
            ok: true,
            already: false,
            run: {
              ...baseRun,
              status: "dispatched",
              buffer_dispatched_at: "2026-11-16T12:35:00.000Z",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const result = await approveAutomationRun("run-test-1");
      assert.ok(requestedUrl.includes("/api/v1/automation/runs/run-test-1/approve"));
      assert.equal(requestedMethod, "POST");
      assert.equal(authHeader, "Bearer test-token-task-11");
      assert.equal(result.ok, true);
      assert.equal(result.run.buffer_dispatched_at, "2026-11-16T12:35:00.000Z");
    });
  });
});
