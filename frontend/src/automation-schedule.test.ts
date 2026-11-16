import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  setToken,
  clearToken,
  getAutomationSchedule,
  updateAccount,
} from "./api";
import {
  formatScheduleStatus,
  formatScheduleChannel,
  formatPublicationStatus,
  type AutoPostSlot,
  type AutomationSchedule,
  type PostWindow,
} from "./types";

describe("Task 12: Agenda panel, settings & account toggle (TDD)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken("test-token-task-12");
  });

  afterEach(() => {
    clearToken();
    globalThis.fetch = originalFetch;
  });

  describe("API: getAutomationSchedule (spec §5.8, §5.9.2 / test 6)", () => {
    it("6. getAutomationSchedule chama GET /api/v1/automation/schedule com date quando informado", async () => {
      let requestedUrl = "";
      let authHeader = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        const headers = new Headers(init?.headers);
        authHeader = headers.get("Authorization") || "";
        const mockSchedule: AutomationSchedule = {
          date: "2026-11-16",
          timezone: "America/Sao_Paulo",
          enabled: true,
          slots: [
            {
              id: "slot-1",
              window_id: "morning",
              account_id: "acc_1",
              account_display_name: "Conta 1",
              account_enabled: true,
              channel: "buffer",
              scheduled_at: "2026-11-16T10:15:00.000Z",
              window_end: "2026-11-16T12:00:00.000Z",
              status: "pending",
              attempts: 0,
              run_id: null,
              run_status: null,
              post_status: null,
              last_error: null,
            },
          ],
        };
        return new Response(JSON.stringify(mockSchedule), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const scheduleWithDate = await getAutomationSchedule("2026-11-16");
      assert.equal(requestedUrl, "/api/v1/automation/schedule?date=2026-11-16");
      assert.equal(authHeader, "Bearer test-token-task-12");
      assert.equal(scheduleWithDate.date, "2026-11-16");
      assert.equal(scheduleWithDate.slots.length, 1);
      const slot: AutoPostSlot = scheduleWithDate.slots[0];
      assert.equal(slot.id, "slot-1");

      const scheduleWithoutDate = await getAutomationSchedule();
      assert.equal(requestedUrl, "/api/v1/automation/schedule");
      assert.equal(scheduleWithoutDate.enabled, true);
    });
  });

  describe("Pure helpers: formatScheduleStatus (spec §5.9.2, §5.11 test 7, 12)", () => {
    it("7 & 12. formatScheduleStatus maps all statuses correctly", () => {
      assert.equal(formatScheduleStatus("pending"), "Agendado");
      assert.equal(formatScheduleStatus("running"), "Gerando/Publicando");
      assert.equal(formatScheduleStatus("awaiting_approval"), "Aguardando aprovação");
      assert.equal(formatScheduleStatus("done"), "Enviado");
      assert.equal(formatScheduleStatus("failed"), "Falhou");
      assert.equal(formatScheduleStatus("skipped"), "Pulado");
      // Fallback for unknown status
      assert.equal(formatScheduleStatus("unknown_status"), "unknown_status");
    });
  });

  describe("Pure helpers: formatScheduleChannel (spec §5.9.2, §5.11 test 7)", () => {
    it("7. formatScheduleChannel maps all channels correctly", () => {
      assert.equal(formatScheduleChannel("buffer"), "Buffer");
      assert.equal(formatScheduleChannel("telegram"), "Telegram");
      assert.equal(formatScheduleChannel("social"), "Social");
      // Fallback for unknown channel
      assert.equal(formatScheduleChannel("custom_channel"), "custom_channel");
    });
  });

  describe("Pure helpers: formatPublicationStatus (spec §5.9.2, §5.11 test 9)", () => {
    it("9. formatPublicationStatus maps queued, processing, published, failed, and null", () => {
      assert.equal(formatPublicationStatus("queued"), "Na fila");
      assert.equal(formatPublicationStatus("processing"), "Processando");
      assert.equal(formatPublicationStatus("published"), "Publicado");
      assert.equal(formatPublicationStatus("failed"), "Falhou");
      assert.equal(formatPublicationStatus(null), "-");
      assert.equal(formatPublicationStatus(undefined), "-");
      assert.equal(formatPublicationStatus(""), "-");
    });
  });

  describe("Account toggle: auto_post_enabled (spec §5.9.4 / Task 12)", () => {
    it("allows updating auto_post_enabled via updateAccount", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        requestedBody = String(init?.body || "");
        return new Response(
          JSON.stringify({
            id: "acc_toggle",
            auto_post_enabled: false,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      const res = await updateAccount("acc_toggle", { auto_post_enabled: false });
      assert.equal(requestedUrl, "/api/v1/accounts/acc_toggle");
      assert.equal(requestedMethod, "PATCH");
      assert.deepEqual(JSON.parse(requestedBody), { auto_post_enabled: false });
      assert.equal(res.auto_post_enabled, false);
    });
  });

  describe("Schedule settings configuration (Task 12)", () => {
    it("allows saving auto_post_timezone via updateSetting", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        requestedBody = String(init?.body || "");
        return new Response(
          JSON.stringify({
            key: "auto_post_timezone",
            value: "America/Manaus",
            updated_at: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const { updateSetting } = await import("./api");
      const res = await updateSetting("auto_post_timezone", "America/Manaus");
      assert.equal(requestedUrl, "/api/v1/settings/auto_post_timezone");
      assert.equal(requestedMethod, "PUT");
      assert.deepEqual(JSON.parse(requestedBody), { value: "America/Manaus" });
      assert.equal(res.value, "America/Manaus");
    });

    it("allows saving auto_post_count_per_day via updateSetting", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        requestedBody = String(init?.body || "");
        return new Response(
          JSON.stringify({
            key: "auto_post_count_per_day",
            value: 2,
            updated_at: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const { updateSetting } = await import("./api");
      const res = await updateSetting("auto_post_count_per_day", 2);
      assert.equal(requestedUrl, "/api/v1/settings/auto_post_count_per_day");
      assert.equal(requestedMethod, "PUT");
      assert.deepEqual(JSON.parse(requestedBody), { value: 2 });
      assert.equal(res.value, 2);
    });

    it("allows saving auto_post_windows via updateSetting", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody = "";

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        requestedBody = String(init?.body || "");
        return new Response(
          JSON.stringify({
            key: "auto_post_windows",
            value: [
              { id: "morning", start: "08:00", end: "10:00" },
              { id: "evening", start: "19:00", end: "21:00" },
            ],
            updated_at: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const { updateSetting } = await import("./api");
      const customWindows: PostWindow[] = [
        { id: "morning", start: "08:00", end: "10:00" },
        { id: "evening", start: "19:00", end: "21:00" },
      ];
      const res = await updateSetting("auto_post_windows", customWindows);
      assert.equal(requestedUrl, "/api/v1/settings/auto_post_windows");
      assert.equal(requestedMethod, "PUT");
      assert.deepEqual(JSON.parse(requestedBody), { value: customWindows });
      assert.deepEqual(res.value, customWindows);
    });
  });
});
