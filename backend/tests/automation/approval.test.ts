import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { buildApp } from "../../src/app.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import {
  createCarouselRun,
  createCarouselSlides,
  getCarouselRun,
} from "../../src/domain/runs/store.js";
import {
  insertSlots,
  listSlotsByDate,
  getSlotById,
  updateSlot,
  type AutoPostSlot,
} from "../../src/domain/automation/slots.js";
import { setSocialPublisherProvider } from "../../src/domain/dispatch/service.js";
import type { SocialPublisherProvider } from "../../src/domain/social/types.js";
import { approveBufferRun } from "../../src/domain/automation/approve.js";
import { createBot } from "../../src/bot.js";
import type {
  AutomationNotifyEvent,
  NotifyPayload,
} from "../../src/domain/automation/notifications.js";
import type { DispatchCarouselFn } from "../../src/domain/automation/ticker.js";

const { Pool } = pg;

describe("Task 7: Approval API + Telegram callback (spec §5.11 items 22–24)", { timeout: 90000 }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let tmpOutputDir: string;

  const testToken = "test-approval-token";
  const authHeaders = { authorization: `Bearer ${testToken}` };

  before(async () => {
    process.env.API_TOKEN = testToken;
    const connectionString =
      process.env.DATABASE_URL ||
      "postgresql://luisfelipe@localhost:5432/redhorse_test";
    process.env.DATABASE_URL = connectionString;
    pool = new Pool({ connectionString });
    await runMigrations(pool);

    tmpOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "task7-output-"));
    process.env.OUTPUT_DIR = tmpOutputDir;
    process.env.SILO_SERVER_URL = "https://silo.example.com";
    process.env.SILO_CAROUSELS_BUCKET = "carousels";

    app = buildApp();
    await app.ready();
  });

  after(async () => {
    setSocialPublisherProvider(null);
    try {
      await pool.query(
        "TRUNCATE auto_post_slots, dispatch_events, carousel_runs, accounts, app_settings CASCADE;"
      );
    } catch {}
    if (app) await app.close();
    await closePool();
    if (pool) await pool.end();
    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    setSocialPublisherProvider({
      async listConnectedAccounts() {
        return [];
      },
      async publishPost(_req) {
        return {
          externalPostId: "ext-buf-test-123",
          status: "queued",
          postUrl: "https://buffer.com/post/123",
        };
      },
    });

    await pool.query(
      "TRUNCATE auto_post_slots, dispatch_events, carousel_runs, accounts, app_settings CASCADE;"
    );
  });

  async function createTestRunAndSlot(options: {
    accountId: string;
    windowEnd?: Date;
    slotStatus?: AutoPostSlot["status"];
    lastError?: string;
  }) {
    const accountId = options.accountId;
    await upsertAccount(
      {
        id: accountId,
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: `ext-${accountId}`,
        social_provider: "buffer",
      },
      pool
    );

    const runDir = path.join(tmpOutputDir, accountId, "run_1");
    fs.mkdirSync(runDir, { recursive: true });
    const slide1 = path.join(runDir, "slide_1.jpg");
    fs.writeFileSync(slide1, "fake-image-bytes");

    const run = await createCarouselRun(
      {
        account_id: accountId,
        account_role: "single_woman",
        archetype_title: "Tendências 2026",
        legenda: "Confira as tendências da temporada",
        status: "generated",
        output_dir: runDir,
      },
      pool
    );

    await createCarouselSlides(
      [
        {
          run_id: run.id,
          position: 1,
          storage_path: slide1,
        },
      ],
      pool
    );

    const now = new Date();
    const windowEnd = options.windowEnd || new Date(Date.now() + 2 * 60 * 60 * 1000);

    await insertSlots(
      [
        {
          slot_date: now.toISOString().substring(0, 10),
          window_id: "morning",
          account_id: accountId,
          channel: "buffer",
          scheduled_at: now,
          window_end: windowEnd,
          status: options.slotStatus || "awaiting_approval",
          last_error: options.lastError || null,
        },
      ],
      pool
    );

    const slots = await listSlotsByDate(now.toISOString().substring(0, 10), pool);
    const slot = slots.find((s) => s.account_id === accountId)!;
    // Link run <-> slot
    await updateSlot(slot.id, { run_id: run.id }, pool);
    await pool.query(
      `UPDATE carousel_runs SET auto_post_slot_id = $1 WHERE id = $2`,
      [slot.id, run.id]
    );

    return { run, slot: (await getSlotById(slot.id, pool))! };
  }

  // =========================================================================
  // Spec §5.11 Item 22: POST /api/v1/automation/runs/:runId/approve
  // =========================================================================
  it("Item 22: POST /api/v1/automation/runs/:runId/approve dispatches to Buffer and marks done; second call returns already: true", async () => {
    const { run, slot } = await createTestRunAndSlot({
      accountId: "acc-approve-22",
    });

    // 1. Call POST /api/v1/automation/runs/:runId/approve
    const res1 = await app.inject({
      method: "POST",
      url: `/api/v1/automation/runs/${run.id}/approve`,
      headers: authHeaders,
    });

    assert.equal(res1.statusCode, 200);
    const body1 = res1.json();
    assert.equal(body1.ok, true);
    assert.ok(body1.run);
    assert.equal(body1.run.id, run.id);
    assert.equal(body1.already, undefined);

    // Slot in DB should be 'done' with approved_at and finished_at set
    const updatedSlot1 = await getSlotById(slot.id, pool);
    assert.equal(updatedSlot1?.status, "done");
    assert.ok(updatedSlot1?.approved_at);
    assert.ok(updatedSlot1?.finished_at);

    // 2. Second call returns already: true (idempotent)
    const res2 = await app.inject({
      method: "POST",
      url: `/api/v1/automation/runs/${run.id}/approve`,
      headers: authHeaders,
    });

    assert.equal(res2.statusCode, 200);
    const body2 = res2.json();
    assert.equal(body2.ok, true);
    assert.equal(body2.already, true);
    assert.ok(body2.run);
  });

  it("Item 22: approveBufferRun sends buffer_accepted notification and custom dispatchFn is triggered", async () => {
    const { run, slot } = await createTestRunAndSlot({
      accountId: "acc-custom-fn",
    });

    let dispatchCalled = 0;
    const dispatchFn: DispatchCarouselFn = async (opts) => {
      dispatchCalled++;
      assert.equal(opts.runId, run.id);
      assert.equal(opts.channel, "buffer");
      assert.equal(opts.triggeredBy, "approval");
      return {
        event: {
          id: "evt-approve-buf",
          run_id: opts.runId,
          channel: "buffer",
          status: "sent",
          triggered_by: "approval",
          request_payload: {},
          response_payload: {},
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        run: run as any,
      };
    };

    const notifications: Array<{ event: AutomationNotifyEvent; payload: NotifyPayload }> = [];
    const notifyFn = async (event: AutomationNotifyEvent, payload: NotifyPayload) => {
      notifications.push({ event, payload });
    };

    const result = await approveBufferRun(run.id, {
      pool,
      dispatchFn,
      notifyFn,
    });

    assert.equal(result.ok, true);
    assert.equal(dispatchCalled, 1);

    const slotAfter = await getSlotById(slot.id, pool);
    assert.equal(slotAfter?.status, "done");

    // Notification buffer_accepted was sent
    const bufAccepted = notifications.find((n) => n.event === "buffer_accepted");
    assert.ok(bufAccepted, "buffer_accepted notification must be sent");
    assert.equal(bufAccepted.payload.account, "acc-custom-fn");
    assert.equal(bufAccepted.payload.runId, run.id);

    // Calling again returns already: true without re-calling dispatchFn
    const secondResult = await approveBufferRun(run.id, {
      pool,
      dispatchFn,
      notifyFn,
    });
    assert.equal(secondResult.ok, true);
    assert.equal(secondResult.already, true);
    assert.equal(dispatchCalled, 1, "dispatchFn must NOT be called again when already done");
  });

  it("Item 22: returns 409 slot_not_awaiting_approval when slot is failed or skipped", async () => {
    const { run } = await createTestRunAndSlot({
      accountId: "acc-failed-slot",
      slotStatus: "failed",
      lastError: "algum erro prévio",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/automation/runs/${run.id}/approve`,
      headers: authHeaders,
    });

    assert.equal(res.statusCode, 409);
    const body = res.json();
    assert.equal(body.error, "slot_not_awaiting_approval");
  });

  it("Item 22: returns 404 when run or slot does not exist", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/automation/runs/${unknownId}/approve`,
      headers: authHeaders,
    });

    assert.equal(res.statusCode, 404);
  });

  it("Item 22: when dispatch fails during approval, notifies publish_failed and triggers retry", async () => {
    const { run, slot } = await createTestRunAndSlot({
      accountId: "acc-disp-fail",
    });

    const dispatchFn: DispatchCarouselFn = async () => {
      throw new Error("Buffer API timeout");
    };

    const notifications: Array<{ event: AutomationNotifyEvent; payload: NotifyPayload }> = [];
    const notifyFn = async (event: AutomationNotifyEvent, payload: NotifyPayload) => {
      notifications.push({ event, payload });
    };

    const now = new Date();
    await assert.rejects(
      async () => {
        await approveBufferRun(run.id, {
          pool,
          now,
          dispatchFn,
          notifyFn,
        });
      },
      /Buffer API timeout/
    );

    const slotAfter = await getSlotById(slot.id, pool);
    // Since attempts is 0 and now+5min < window_end, slot goes to pending with retry
    assert.equal(slotAfter?.status, "pending");
    assert.equal(slotAfter?.last_error, "Buffer API timeout");
    assert.equal(
      slotAfter?.scheduled_at.toISOString(),
      new Date(now.getTime() + 5 * 60 * 1000).toISOString()
    );

    const failNotif = notifications.find((n) => n.event === "publish_failed");
    assert.ok(failNotif, "publish_failed notification must be sent");
    assert.equal(failNotif.payload.reason, "Buffer API timeout");
  });

  // =========================================================================
  // Spec §5.11 Item 23: approval after window_end -> 410 and slot skipped
  // =========================================================================
  it("Item 23: approval after window_end -> 410 and slot skipped ('aprovação expirada')", async () => {
    const windowEnd = new Date("2026-11-16T10:00:00.000Z");
    const { run, slot } = await createTestRunAndSlot({
      accountId: "acc-expired-23",
      windowEnd,
    });

    // We make now later than windowEnd
    const nowAfter = new Date("2026-11-16T10:01:00.000Z");

    await assert.rejects(
      async () => {
        await approveBufferRun(run.id, {
          pool,
          now: nowAfter,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 410);
        assert.equal(err.code, "approval_expired");
        return true;
      }
    );

    const slotAfter = await getSlotById(slot.id, pool);
    assert.equal(slotAfter?.status, "skipped");
    assert.equal(slotAfter?.last_error, "aprovação expirada");
    assert.ok(slotAfter?.finished_at);

    // Also verify via HTTP route
    // Reset slot back to awaiting_approval with expired window_end to test HTTP route returns 410
    await updateSlot(
      slot.id,
      {
        status: "awaiting_approval",
        window_end: new Date("2020-01-01T00:00:00.000Z"), // definitely in the past
      },
      pool
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/automation/runs/${run.id}/approve`,
      headers: authHeaders,
    });

    assert.equal(res.statusCode, 410);
    const body = res.json();
    assert.equal(body.error, "approval_expired");
  });

  // =========================================================================
  // Spec §5.11 Item 24: callback approve_buffer:<runId> on bot
  // =========================================================================
  it("Item 24: bot callback approve_buffer:<runId> calls approveBufferRun, answers callback and edits message", async () => {
    const { run, slot } = await createTestRunAndSlot({
      accountId: "acc-bot-24",
    });

    const bot = createBot({
      token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      allowedUserIds: [],
      pool,
      botInfo: {
        id: 123456,
        is_bot: true,
        first_name: "RedHorseBot",
        username: "redhorse_bot",
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      },
    });

    assert.ok(bot, "bot must be created");

    const apiCalls: Array<{ method: string; payload: any }> = [];
    bot.api.config.use(async (_prev, method, payload) => {
      apiCalls.push({ method, payload });
      return { ok: true, result: true } as any;
    });

    // 1. Send callback query approve_buffer:<runId>
    await bot.handleUpdate({
      update_id: 101,
      callback_query: {
        id: "cb-query-1",
        from: { id: 999, is_bot: false, first_name: "Tester" },
        message: {
          message_id: 555,
          chat: { id: 999, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "🕐 Aguardando aprovação — @acc-bot-24 — arquétipo: Tendências 2026",
        },
        chat_instance: "ci-101",
        data: `approve_buffer:${run.id}`,
      },
    });

    // Verify slot marked done
    const slotDone = await getSlotById(slot.id, pool);
    assert.equal(slotDone?.status, "done");

    // Verify answerCallbackQuery was called
    const answerCall = apiCalls.find((c) => c.method === "answerCallbackQuery");
    assert.ok(answerCall, "answerCallbackQuery must be called");
    assert.equal(answerCall.payload.callback_query_id, "cb-query-1");

    // Verify editMessageText was called
    const editCall = apiCalls.find((c) => c.method === "editMessageText");
    assert.ok(editCall, "editMessageText must be called");
    assert.equal(editCall.payload.chat_id, 999);
    assert.equal(editCall.payload.message_id, 555);
    assert.match(editCall.payload.text, /Enviado ao Buffer/);

    // 2. Second callback query on same run (already approved)
    apiCalls.length = 0;
    await bot.handleUpdate({
      update_id: 102,
      callback_query: {
        id: "cb-query-2",
        from: { id: 999, is_bot: false, first_name: "Tester" },
        message: {
          message_id: 555,
          chat: { id: 999, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: editCall.payload.text,
        },
        chat_instance: "ci-101",
        data: `approve_buffer:${run.id}`,
      },
    });

    const secondAnswer = apiCalls.find((c) => c.method === "answerCallbackQuery");
    assert.ok(secondAnswer, "answerCallbackQuery must be called on duplicate");
    assert.match(secondAnswer.payload.text, /já/i);

    // 3. Callback query on expired run
    const { run: expiredRun, slot: expiredSlot } = await createTestRunAndSlot({
      accountId: "acc-bot-exp",
      windowEnd: new Date("2020-01-01T00:00:00.000Z"),
    });

    apiCalls.length = 0;
    await bot.handleUpdate({
      update_id: 103,
      callback_query: {
        id: "cb-query-3",
        from: { id: 999, is_bot: false, first_name: "Tester" },
        message: {
          message_id: 777,
          chat: { id: 999, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "🕐 Aguardando aprovação — @acc-bot-exp",
        },
        chat_instance: "ci-103",
        data: `approve_buffer:${expiredRun.id}`,
      },
    });

    const expiredAnswer = apiCalls.find((c) => c.method === "answerCallbackQuery");
    assert.ok(expiredAnswer, "answerCallbackQuery must be called on expired");
    assert.match(expiredAnswer.payload.text, /expirad/i);

    const expiredSlotAfter = await getSlotById(expiredSlot.id, pool);
    assert.equal(expiredSlotAfter?.status, "skipped");
    assert.equal(expiredSlotAfter?.last_error, "aprovação expirada");
  });

  it("Item 22 (concurrency): concurrent calls to approveBufferRun dispatch only once", async () => {
    const { run } = await createTestRunAndSlot({
      accountId: "acc-concurrent",
    });

    let dispatchCount = 0;
    const dispatchFn: DispatchCarouselFn = async (opts) => {
      dispatchCount++;
      // Simulate small async delay during dispatch
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        event: {
          id: "evt-concurrent",
          run_id: opts.runId,
          channel: "buffer",
          status: "sent",
          triggered_by: "approval",
          request_payload: {},
          response_payload: {},
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        run: run as any,
      };
    };

    const [res1, res2] = await Promise.all([
      approveBufferRun(run.id, { pool, dispatchFn }),
      approveBufferRun(run.id, { pool, dispatchFn }),
    ]);

    assert.equal(dispatchCount, 1, "dispatchFn must be called exactly once across concurrent calls");
    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);
    // At least one of the responses should indicate already: true or both return ok: true
    const alreadyCount = (res1.already ? 1 : 0) + (res2.already ? 1 : 0);
    assert.equal(alreadyCount, 1, "exactly one caller should receive already: true");
  });

  it("Item 24: bot callback query on dispatch error answers with error and edits message", async () => {
    const { run } = await createTestRunAndSlot({
      accountId: "acc-bot-err",
    });

    const bot = createBot({
      token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      allowedUserIds: [],
      pool,
      botInfo: {
        id: 123456,
        is_bot: true,
        first_name: "RedHorseBot",
        username: "redhorse_bot",
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      },
      approveBufferRunFn: async () => {
        throw new Error("Buffer network unreachable");
      },
    });

    const apiCalls: Array<{ method: string; payload: any }> = [];
    bot!.api.config.use(async (_prev, method, payload) => {
      apiCalls.push({ method, payload });
      return { ok: true, result: true } as any;
    });

    await bot!.handleUpdate({
      update_id: 104,
      callback_query: {
        id: "cb-query-err",
        from: { id: 999, is_bot: false, first_name: "Tester" },
        message: {
          message_id: 888,
          chat: { id: 999, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "🕐 Aguardando aprovação — @acc-bot-err",
        },
        chat_instance: "ci-104",
        data: `approve_buffer:${run.id}`,
      },
    });

    const answerCall = apiCalls.find((c) => c.method === "answerCallbackQuery");
    assert.ok(answerCall);
    assert.match(answerCall.payload.text, /Buffer network unreachable/);

    const editCall = apiCalls.find((c) => c.method === "editMessageText");
    assert.ok(editCall);
    assert.match(editCall.payload.text, /❌ Falha ao enviar ao Buffer/);
  });

  it("Item 24: bot callback query with unrelated data is ignored", async () => {
    const bot = createBot({
      token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      allowedUserIds: [],
      pool,
      botInfo: {
        id: 123456,
        is_bot: true,
        first_name: "RedHorseBot",
        username: "redhorse_bot",
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      },
    });

    const apiCalls: Array<{ method: string; payload: any }> = [];
    bot!.api.config.use(async (_prev, method, payload) => {
      apiCalls.push({ method, payload });
      return { ok: true, result: true } as any;
    });

    await bot!.handleUpdate({
      update_id: 105,
      callback_query: {
        id: "cb-query-other",
        from: { id: 999, is_bot: false, first_name: "Tester" },
        message: {
          message_id: 999,
          chat: { id: 999, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "Other message",
        },
        chat_instance: "ci-105",
        data: "some_other_action:123",
      },
    });

    assert.equal(apiCalls.length, 0, "no bot API calls for unrelated callback data");
  });
});

