import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { setSetting } from "../../src/domain/settings/store.js";
import {
  createCarouselRun,
  createCarouselSlides,
  getCarouselRun,
  updateCarouselRun,
  type CreateCarouselRunInput,
} from "../../src/domain/runs/store.js";
import type { CarouselRun } from "../../src/domain/runs/schemas.js";
import {
  insertSlots,
  listSlotsByDate,
  getSlotById,
  updateSlot,
  type AutoPostSlot,
} from "../../src/domain/automation/slots.js";
import {
  runAutomationTick,
  resetTickerBusy,
  type GenerateCarouselFn,
  type DispatchCarouselFn,
  type NotifyAutomationFn,
} from "../../src/domain/automation/ticker.js";
import type { AutomationNotifyEvent, NotifyPayload } from "../../src/domain/automation/notifications.js";
import { withJobLock } from "../../src/jobLock.js";

const { Pool } = pg;

describe("Task 6: Ticker + executeSlot (spec §5.11 items 7–12, 17, 19–21)", { timeout: 90000 }, () => {
  let pool: pg.Pool;

  before(async () => {
    const connectionString =
      process.env.DATABASE_URL ||
      "postgresql://luisfelipe@localhost:5432/redhorse_test";
    process.env.DATABASE_URL = connectionString;
    pool = new Pool({ connectionString });
    await runMigrations(pool);
  });

  after(async () => {
    try {
      await pool.query(
        "TRUNCATE auto_post_slots, dispatch_events, carousel_runs, accounts, app_settings CASCADE;"
      );
    } catch {}
    await closePool();
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    resetTickerBusy();
    await pool.query(
      "TRUNCATE auto_post_slots, dispatch_events, carousel_runs, accounts, app_settings CASCADE;"
    );
    await setSetting("auto_dispatch_enabled", true, pool);
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);
    await setSetting(
      "auto_post_windows",
      [
        { id: "morning", start: "07:00", end: "09:00" },
        { id: "afternoon", start: "12:00", end: "14:00" },
        { id: "night", start: "19:00", end: "21:00" },
      ],
      pool
    );
  });

  async function createTestRunInDb(
    accountId: string,
    overrides: Partial<CreateCarouselRunInput> = {}
  ): Promise<CarouselRun> {
    const run = await createCarouselRun(
      {
        account_id: accountId,
        account_role: "single_woman",
        archetype_title: "Reflexão",
        legenda: "Legenda de teste",
        status: "generated",
        ...overrides,
      },
      pool
    );
    await createCarouselSlides(
      [
        {
          run_id: run.id,
          position: 1,
          slide_type: "cover",
          storage_path: "runs/mock/slide_1.jpg",
        },
      ],
      pool
    );
    const loaded = await getCarouselRun(run.id, pool);
    if (!loaded) throw new Error("Failed to load created run");
    return loaded;
  }

  // Spec §5.11 Item 7: claim de no máximo 1 slot por tick; segundo tick executa o próximo.
  it("Item 7: claims at most 1 slot per tick; second tick executes next slot", async () => {
    await setSetting(
      "auto_post_windows",
      [{ id: "morning", start: "07:00", end: "09:00" }],
      pool
    );

    await upsertAccount(
      {
        id: "acc-1",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );
    await upsertAccount(
      {
        id: "acc-2",
        persona: "P2",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z"); // 07:00 Sao Paulo
    const windowEnd = new Date("2026-11-16T12:00:00.000Z"); // 09:00 Sao Paulo

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-1",
          channel: "telegram",
          scheduled_at: new Date(now.getTime() - 1000),
          window_end: windowEnd,
        },
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-2",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    let generatedCount = 0;
    const generateFn: GenerateCarouselFn = async (opts) => {
      generatedCount++;
      return createTestRunInDb(opts.accountId);
    };

    let dispatchedCount = 0;
    const dispatchFn: DispatchCarouselFn = async (opts) => {
      dispatchedCount++;
      return {
        event: {
          id: "evt-1",
          run_id: opts.runId,
          channel: opts.channel,
          status: "sent",
          triggered_by: opts.triggeredBy || "auto_schedule",
          request_payload: {},
          response_payload: {},
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        run: {} as any,
      };
    };

    // First tick: claims 1 slot
    const tick1 = await runAutomationTick({
      pool,
      now,
      generateFn,
      dispatchFn,
    });
    assert.equal(tick1.ran, true);
    assert.equal(generatedCount, 1);
    assert.equal(dispatchedCount, 1);

    const slotsAfterTick1 = await listSlotsByDate("2026-11-16", pool);
    const doneSlots1 = slotsAfterTick1.filter((s) => s.status === "done");
    const pendingSlots1 = slotsAfterTick1.filter((s) => s.status === "pending");
    assert.equal(doneSlots1.length, 1);
    assert.equal(pendingSlots1.length, 1);

    // Second tick: claims next slot
    const tick2 = await runAutomationTick({
      pool,
      now,
      generateFn,
      dispatchFn,
    });
    assert.equal(tick2.ran, true);
    assert.equal(generatedCount, 2);
    assert.equal(dispatchedCount, 2);

    const slotsAfterTick2 = await listSlotsByDate("2026-11-16", pool);
    const doneSlots2 = slotsAfterTick2.filter((s) => s.status === "done");
    const pendingSlots2 = slotsAfterTick2.filter((s) => s.status === "pending");
    assert.equal(doneSlots2.length, 2);
    assert.equal(pendingSlots2.length, 0);

    // Third tick: no more pending slots
    const tick3 = await runAutomationTick({
      pool,
      now,
      generateFn,
      dispatchFn,
    });
    assert.equal(tick3.ran, false);
  });

  // Spec §5.11 Item 8: reentrada concorrente retorna { ran: false }.
  it("Item 8: concurrent reentrancy returns { ran: false }", async () => {
    await upsertAccount(
      {
        id: "acc-reentry",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-reentry",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    let resolveGenerate: (run: CarouselRun) => void;
    const generatePromise = new Promise<CarouselRun>((res) => {
      resolveGenerate = res;
    });

    const slowGenerateFn: GenerateCarouselFn = async (opts) => {
      return generatePromise;
    };

    // Start first tick in background (waiting on generatePromise)
    const tickPromise1 = runAutomationTick({
      pool,
      now,
      generateFn: slowGenerateFn,
    });

    // Attempt second tick concurrently
    try {
      const tick2 = await runAutomationTick({
        pool,
        now,
        generateFn: slowGenerateFn,
      });
      assert.equal(tick2.ran, false);
      assert.equal(tick2.reason, "busy");
    } finally {
      // Complete the first tick
      const createdRun = await createTestRunInDb("acc-reentry");
      resolveGenerate!(createdRun);
      const tick1 = await tickPromise1;
      assert.equal(tick1.ran, true);
    }

    // Also verify when jobLock is busy externally
    const jobLockBusyResult = await withJobLock(async () => {
      return runAutomationTick({ pool, now });
    });
    assert.equal(jobLockBusyResult.ran, false);
    assert.equal(jobLockBusyResult.reason, "busy");
  });

  // Spec §5.11 Item 9: canal Buffer para conta vinculada; Telegram para conta sem vínculo (com dispatchFn fake).
  it("Item 9: resolves Buffer channel for linked account; Telegram for unlinked account", async () => {
    // Linked account (buffer)
    await upsertAccount(
      {
        id: "acc-buf",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: "ext-123",
        social_provider: "zernio",
      },
      pool
    );

    // Unlinked account (telegram)
    await upsertAccount(
      {
        id: "acc-tg",
        persona: "P2",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-buf",
          channel: "zernio",
          scheduled_at: now,
          window_end: windowEnd,
        },
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-tg",
          channel: "telegram",
          scheduled_at: new Date(now.getTime() + 1000),
          window_end: windowEnd,
        },
      ],
      pool
    );

    const generateFn: GenerateCarouselFn = async (opts) => {
      return createTestRunInDb(opts.accountId);
    };

    let dispatchedChannel: string | null = null;
    const dispatchFn: DispatchCarouselFn = async (opts) => {
      dispatchedChannel = opts.channel;
      return {
        event: {
          id: "evt-9",
          run_id: opts.runId,
          channel: opts.channel,
          status: "sent",
          triggered_by: opts.triggeredBy || "auto_schedule",
          request_payload: {},
          response_payload: {},
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        run: {} as any,
      };
    };

    // Tick 1: processes acc-buf -> dispatches zernio directly
    await runAutomationTick({ pool, now, generateFn, dispatchFn });
    assert.equal(dispatchedChannel, "zernio");

    // Tick 2: processes acc-tg -> dispatches telegram
    await runAutomationTick({
      pool,
      now: new Date(now.getTime() + 1000),
      generateFn,
      dispatchFn,
    });
    assert.equal(dispatchedChannel, "telegram");

    const slots = await listSlotsByDate("2026-11-16", pool);
    const bufSlot = slots.find((s) => s.account_id === "acc-buf");
    const tgSlot = slots.find((s) => s.account_id === "acc-tg");

    assert.equal(bufSlot?.status, "done");
    assert.equal(bufSlot?.channel, "zernio");
    assert.equal(tgSlot?.status, "done");
    assert.equal(tgSlot?.channel, "telegram");
  });

  // Spec §5.11 Item 10: retry de geração — primeira falha deixa pending com scheduled_at ≈ now+5; segunda falha marca failed.
  it("Item 10: generation retry — first failure leaves pending with scheduled_at ≈ now+5min; second failure marks failed", async () => {
    await upsertAccount(
      {
        id: "acc-gen-fail",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-gen-fail",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    const notifications: Array<{ event: AutomationNotifyEvent; payload: NotifyPayload }> = [];
    const notifyFn: NotifyAutomationFn = async (event, payload) => {
      notifications.push({ event, payload });
    };

    const failingGenerateFn: GenerateCarouselFn = async () => {
      throw new Error("AI generation timeout");
    };

    // First tick: attempt 1 fails
    const tick1 = await runAutomationTick({
      pool,
      now,
      generateFn: failingGenerateFn,
      notifyFn,
    });
    assert.equal(tick1.ran, true);

    const [slotAfter1] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slotAfter1.status, "pending");
    assert.equal(slotAfter1.attempts, 1);
    assert.equal(slotAfter1.last_error, "AI generation timeout");
    const expectedRetryTime = new Date(now.getTime() + 5 * 60 * 1000);
    assert.equal(slotAfter1.scheduled_at.getTime(), expectedRetryTime.getTime());

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].event, "generation_failed");
    assert.equal(notifications[0].payload.reason, "AI generation timeout");

    // Second tick at retry time: attempt 2 fails -> marked failed
    const tick2 = await runAutomationTick({
      pool,
      now: expectedRetryTime,
      generateFn: failingGenerateFn,
      notifyFn,
    });
    assert.equal(tick2.ran, true);

    const [slotAfter2] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slotAfter2.status, "failed");
    assert.equal(slotAfter2.attempts, 2);
    assert.equal(slotAfter2.last_error, "AI generation timeout");
    assert.ok(slotAfter2.finished_at);

    assert.equal(notifications.length, 2);
    assert.equal(notifications[1].event, "generation_failed");
  });

  // Spec §5.11 Item 11: retry de dispatch reutiliza o mesmo run_id e não chama geração de novo.
  it("Item 11: dispatch retry reuses the same run_id and does not call generation again", async () => {
    await upsertAccount(
      {
        id: "acc-disp-retry",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-disp-retry",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    let generateCount = 0;
    const generateFn: GenerateCarouselFn = async (opts) => {
      generateCount++;
      return createTestRunInDb(opts.accountId);
    };

    let dispatchAttempts = 0;
    const dispatchFn: DispatchCarouselFn = async (opts) => {
      dispatchAttempts++;
      if (dispatchAttempts === 1) {
        throw new Error("Telegram rate limited");
      }
      return {
        event: {
          id: "evt-disp-ok",
          run_id: opts.runId,
          channel: opts.channel,
          status: "sent",
          triggered_by: opts.triggeredBy || "auto_schedule",
          request_payload: {},
          response_payload: {},
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        run: {} as any,
      };
    };

    // Tick 1: Generation succeeds, but dispatch fails -> pending at now+5min
    await runAutomationTick({ pool, now, generateFn, dispatchFn });
    assert.equal(generateCount, 1);
    assert.equal(dispatchAttempts, 1);

    const [slotAfter1] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slotAfter1.status, "pending");
    assert.ok(slotAfter1.run_id);
    const originalRunId = slotAfter1.run_id;

    // Tick 2 (after 5 min): Retry dispatch -> must reuse originalRunId without calling generateFn
    const retryTime = new Date(now.getTime() + 5 * 60 * 1000);
    await runAutomationTick({ pool, now: retryTime, generateFn, dispatchFn });

    assert.equal(generateCount, 1, "generateFn must NOT be called on dispatch retry");
    assert.equal(dispatchAttempts, 2, "dispatchFn must be attempted again");

    const [slotAfter2] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slotAfter2.status, "done");
    assert.equal(slotAfter2.run_id, originalRunId);
  });

  // Spec §5.11 Item 12: running antigo (>15 min) vira failed.
  it("Item 12: stale running slot (>15 min) becomes failed, boot recovery marks all running failed", async () => {
    await upsertAccount(
      {
        id: "acc-stale",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-stale",
          channel: "telegram",
          scheduled_at: new Date(now.getTime() - 20 * 60 * 1000),
          window_end: windowEnd,
        },
      ],
      pool
    );

    // Manually mark slot as running started 16 minutes ago
    const [insertedSlot] = await listSlotsByDate("2026-11-16", pool);
    await updateSlot(
      insertedSlot.id,
      {
        status: "running",
        started_at: new Date(now.getTime() - 16 * 60 * 1000),
      },
      pool
    );

    // Run tick without boot recovery -> stale running > 15min must be failed
    await runAutomationTick({ pool, now });

    const [recoveredSlot] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(recoveredSlot.status, "failed");
    assert.equal(recoveredSlot.last_error, "execução travada");

    // Now test boot recovery: running 2 minutes ago marked failed with 'processo reiniciou durante a execução'
    await updateSlot(
      insertedSlot.id,
      {
        status: "running",
        started_at: new Date(now.getTime() - 2 * 60 * 1000),
      },
      pool
    );

    await runAutomationTick({ pool, now, recoverStaleRunning: true });

    const [bootRecovered] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(bootRecovered.status, "failed");
    assert.equal(bootRecovered.last_error, "processo reiniciou durante a execução");
  });

  // Spec §5.11 Item 17: run despachado só para Telegram → slot Buffer reenvia ao Buffer;
  // run já published (manual/outro canal) sem evento sent no canal → slot skipped.
  it("Item 17: run dispatched only to Telegram -> Buffer slot sets awaiting_approval; run already published -> slot skipped", async () => {
    await upsertAccount(
      {
        id: "acc-buf-17",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: "ext-17",
        social_provider: "zernio",
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    // Create a run in DB with slides
    const run1 = await createTestRunInDb("acc-buf-17", { status: "generated" });

    // Insert a dispatch_events for telegram 'sent' (NOT buffer)
    await pool.query(
      `INSERT INTO dispatch_events (run_id, channel, status, triggered_by, request_payload, sent_at)
       VALUES ($1, 'telegram', 'sent', 'manual', '{}', NOW())`,
      [run1.id]
    );

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-buf-17",
          channel: "zernio",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    // Link slot to run1
    const [slot1] = await listSlotsByDate("2026-11-16", pool);
    await updateSlot(slot1.id, { run_id: run1.id }, pool);

    let generateCount = 0;
    const generateFn: GenerateCarouselFn = async (opts) => {
      generateCount++;
      return createTestRunInDb(opts.accountId);
    };

    let dispatchedChannel: string | null = null;
    const dispatchFn: DispatchCarouselFn = async (opts) => {
      dispatchedChannel = opts.channel;
      return {
        event: {
          id: "evt-17",
          run_id: opts.runId,
          channel: opts.channel,
          status: "sent",
          triggered_by: opts.triggeredBy || "auto_schedule",
          request_payload: {},
          response_payload: {},
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        run: {} as any,
      };
    };

    // Tick 1: Telegram event exists, but channel is Zernio -> reuses run, dispatches to Zernio
    await runAutomationTick({ pool, now, generateFn, dispatchFn });
    assert.equal(generateCount, 0, "must reuse run1");
    assert.equal(dispatchedChannel, "zernio");

    const slot1After = await getSlotById(slot1.id, pool);
    assert.equal(slot1After?.status, "done");

    // Part B: Run is already published, without sent event for Buffer -> slot skipped
    const run2 = await createTestRunInDb("acc-buf-17", { status: "published" });

    // afternoon slot was created by ensureDailyPlan during tick 1
    const [slot2] = (await listSlotsByDate("2026-11-16", pool)).filter(
      (s) => s.window_id === "afternoon"
    );
    assert.ok(slot2, "afternoon slot should exist");

    // Advance to afternoon window: 12:30 Sao Paulo = 15:30 UTC
    const now2 = new Date("2026-11-16T15:30:00.000Z");
    await updateSlot(
      slot2.id,
      { run_id: run2.id, scheduled_at: now2 },
      pool
    );

    await runAutomationTick({
      pool,
      now: now2,
      generateFn,
    });

    const slot2After = await getSlotById(slot2.id, pool);
    assert.equal(slot2After?.status, "skipped");
    assert.equal(slot2After?.last_error, "carrossel já publicado");
  });

  // Spec §5.11 Item 19: conta postforme com external_account_id → slot social e executor marca skipped com erro claro, sem enviar Telegram.
  it("Item 19: postforme account with external_account_id -> slot social and executor marks skipped with clear error, without sending Telegram", async () => {
    await upsertAccount(
      {
        id: "acc-postforme",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: "ext-postforme",
        social_provider: "postforme",
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-postforme",
          channel: "social",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    let dispatchCalled = false;
    const dispatchFn: DispatchCarouselFn = async () => {
      dispatchCalled = true;
      throw new Error("Should not be called");
    };

    await runAutomationTick({ pool, now, dispatchFn });
    assert.equal(dispatchCalled, false);

    const [slot] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slot.status, "skipped");
    assert.equal(slot.channel, "social");
    assert.equal(slot.last_error, "provider não suportado nesta fase");
  });

  // Spec §5.11 Item 20: conta Zernio → slot despachado diretamente para Zernio, slot done, notificação buffer_accepted enviada.
  it("Item 20: Zernio account -> slot is dispatched directly to zernio, slot done, buffer_accepted notification sent", async () => {
    await upsertAccount(
      {
        id: "acc-buf-20",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: "ext-buf-20",
        social_provider: "zernio",
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-buf-20",
          channel: "zernio",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    const notifications: Array<{ event: AutomationNotifyEvent; payload: NotifyPayload; options?: any }> = [];
    const notifyFn: NotifyAutomationFn = async (event, payload, opts) => {
      notifications.push({ event, payload, options: opts });
    };

    const generateFn: GenerateCarouselFn = async (opts) => {
      return createTestRunInDb(opts.accountId);
    };

    let dispatchCalled = false;
    const dispatchFn: DispatchCarouselFn = async (opts) => {
      dispatchCalled = true;
      return {
        event: {
          id: "evt-buf-20",
          run_id: opts.runId,
          channel: opts.channel,
          status: "sent",
          triggered_by: opts.triggeredBy || "auto_schedule",
          request_payload: {},
          response_payload: {},
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        run: {} as any,
      };
    };

    await runAutomationTick({
      pool,
      now,
      generateFn,
      dispatchFn,
      notifyFn,
      appBaseUrl: "https://redhorse.app",
    });

    assert.equal(dispatchCalled, true);

    const [slot] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slot.status, "done");
    assert.equal(slot.channel, "zernio");
    assert.ok(slot.run_id);

    const run = await getCarouselRun(slot.run_id, pool);
    assert.equal(run?.status, "generated");

    // Notifications: generation_ok + buffer_accepted
    const acceptedNotif = notifications.find((n) => n.event === "buffer_accepted");
    assert.ok(acceptedNotif, "buffer_accepted notification must be sent");
    assert.equal(acceptedNotif.payload.runId, slot.run_id);
    assert.equal(acceptedNotif.options?.appBaseUrl, "https://redhorse.app");
  });

  // Spec §5.11 Item 21: conta Telegram → gera e envia álbum, slot done, notificação de sucesso enviada.
  it("Item 21: Telegram account -> generates and sends album, slot done, success notification sent", async () => {
    await upsertAccount(
      {
        id: "acc-tg-21",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-tg-21",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    const notifications: Array<{ event: AutomationNotifyEvent; payload: NotifyPayload }> = [];
    const notifyFn: NotifyAutomationFn = async (event, payload) => {
      notifications.push({ event, payload });
    };

    const generateFn: GenerateCarouselFn = async (opts) => {
      return createTestRunInDb(opts.accountId);
    };

    let dispatchedRunId: string | null = null;
    let dispatchedChannel: string | null = null;
    let dispatchedTriggeredBy: string | null = null;
    const dispatchFn: DispatchCarouselFn = async (opts) => {
      dispatchedRunId = opts.runId;
      dispatchedChannel = opts.channel;
      dispatchedTriggeredBy = opts.triggeredBy ?? null;
      return {
        event: {
          id: "evt-21",
          run_id: opts.runId,
          channel: opts.channel,
          status: "sent",
          triggered_by: opts.triggeredBy || "auto_schedule",
          request_payload: {},
          response_payload: {},
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        run: {} as any,
      };
    };

    await runAutomationTick({
      pool,
      now,
      generateFn,
      dispatchFn,
      notifyFn,
    });

    const [slot] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slot.status, "done");
    assert.equal(slot.channel, "telegram");
    assert.ok(slot.finished_at);
    assert.equal(dispatchedRunId, slot.run_id);
    assert.equal(dispatchedChannel, "telegram");
    assert.equal(dispatchedTriggeredBy, "auto_schedule");

    // Notifications: generation_ok + telegram_sent
    const genNotif = notifications.find((n) => n.event === "generation_ok");
    const sentNotif = notifications.find((n) => n.event === "telegram_sent");
    assert.ok(genNotif, "generation_ok notification must be sent");
    assert.ok(sentNotif, "telegram_sent notification must be sent");
  });

  // Expiry of awaiting_approval slots past window_end
  it("expires awaiting_approval slots past window_end to skipped ('aprovação expirada')", async () => {
    await upsertAccount(
      {
        id: "acc-exp",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: "ext-exp",
        social_provider: "zernio",
      },
      pool
    );

    const now = new Date("2026-11-16T12:05:00.000Z"); // past morning window_end (12:00)
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-exp",
          channel: "zernio",
          scheduled_at: new Date("2026-11-16T10:00:00.000Z"),
          window_end: windowEnd,
        },
      ],
      pool
    );

    const [inserted] = await listSlotsByDate("2026-11-16", pool);
    await updateSlot(inserted.id, { status: "awaiting_approval" }, pool);

    await runAutomationTick({ pool, now });

    const [expired] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(expired.status, "skipped");
    assert.equal(expired.last_error, "aprovação expirada");
    assert.ok(expired.finished_at);
  });

  // auto_dispatch_enabled = false returns { ran: false } and calls ensureDailyPlan
  it("when auto_dispatch_enabled = false, ensures plan (expiring overdue) and returns { ran: false }", async () => {
    await setSetting("auto_dispatch_enabled", false, pool);

    const now = new Date("2026-11-16T10:00:00.000Z");
    const tick = await runAutomationTick({ pool, now });
    assert.equal(tick.ran, false);
  });

  // Disabled account skips slot
  it("skips slot when account is disabled (enabled=false or auto_post_enabled=false)", async () => {
    await upsertAccount(
      {
        id: "acc-disabled",
        persona: "P1",
        role: "single_woman",
        enabled: false,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-disabled",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    let generateCalled = false;
    const generateFn: GenerateCarouselFn = async () => {
      generateCalled = true;
      throw new Error("should not generate");
    };

    const tick = await runAutomationTick({ pool, now, generateFn });
    assert.equal(tick.ran, true);
    assert.equal(generateCalled, false);

    const [slot] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slot.status, "skipped");
    assert.equal(slot.last_error, "conta desativada");
    assert.ok(slot.finished_at);
  });

  // Test for auto_post_enabled=false explicitly
  it("skips slot when account has auto_post_enabled=false (even if enabled=true)", async () => {
    await upsertAccount(
      {
        id: "acc-autopost-false",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: false,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-autopost-false",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    let generateCalled = false;
    const generateFn: GenerateCarouselFn = async () => {
      generateCalled = true;
      throw new Error("should not generate");
    };

    const tick = await runAutomationTick({ pool, now, generateFn });
    assert.equal(tick.ran, true);
    assert.equal(generateCalled, false);

    const [slot] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slot.status, "skipped");
    assert.equal(slot.last_error, "conta desativada");
    assert.ok(slot.finished_at);
  });

  // Test for unexpected throw inside executeSlot
  it("catches unexpected throw during executeSlot and retries/fails slot instead of leaving it in running", async () => {
    await upsertAccount(
      {
        id: "acc-unexpected-err",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-unexpected-err",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    // Create a pool proxy that fails on SELECT ... FROM accounts
    let failedOnce = false;
    const faultyPool = new Proxy(pool, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return async function (queryText: any, ...args: any[]) {
            const sql = typeof queryText === "string" ? queryText : queryText?.text || "";
            if (!failedOnce && sql.includes("FROM accounts") && sql.includes("WHERE id = $1")) {
              failedOnce = true;
              throw new Error("Fatal database crash loading account");
            }
            return (target.query as any).call(target, queryText, ...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const tick = await runAutomationTick({
      pool: faultyPool,
      now,
    });
    assert.equal(tick.ran, true);

    const [slot] = await listSlotsByDate("2026-11-16", pool);
    assert.notEqual(slot.status, "running", "Slot must not remain in running state");
    assert.equal(slot.status, "pending");
    assert.equal(slot.attempts, 1);
    assert.equal(slot.last_error, "Fatal database crash loading account");
  });

  // Test for expiry when busy
  it("when tickerBusy or jobLock busy, runs expiry of awaiting_approval slots before returning busy", async () => {
    await upsertAccount(
      {
        id: "acc-busy-exp",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: "ext-busy-exp",
        social_provider: "zernio",
      },
      pool
    );

    const now = new Date("2026-11-16T12:05:00.000Z"); // past morning window_end (12:00)
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-busy-exp",
          channel: "zernio",
          scheduled_at: new Date("2026-11-16T10:00:00.000Z"),
          window_end: windowEnd,
        },
      ],
      pool
    );

    const [inserted] = await listSlotsByDate("2026-11-16", pool);
    await updateSlot(inserted.id, { status: "awaiting_approval" }, pool);

    // Call when jobLock is busy
    const busyResult = await withJobLock(async () => {
      return runAutomationTick({ pool, now });
    });
    assert.equal(busyResult.ran, false);
    assert.equal(busyResult.reason, "busy");

    // The overdue awaiting_approval slot should have been expired anyway!
    const [expired] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(expired.status, "skipped");
    assert.equal(expired.last_error, "aprovação expirada");
  });

  // Crash idempotency: when dispatch_events already has status=sent for resolved channel -> slot goes done without calling generateFn or dispatchFn
  it("crash idempotency: when dispatch_events already has sent for resolved channel, marks slot done without calling generateFn or dispatchFn", async () => {
    await upsertAccount(
      {
        id: "acc-crash-idem",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    // Pre-create run with slides
    const run = await createTestRunInDb("acc-crash-idem", { status: "generated" });

    // Pre-insert dispatch_events status='sent' for telegram
    await pool.query(
      `INSERT INTO dispatch_events (run_id, channel, status, triggered_by, request_payload, response_payload, sent_at)
       VALUES ($1, 'telegram', 'sent', 'auto_schedule', '{}', '{}', NOW())`,
      [run.id]
    );

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-crash-idem",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    const [slot] = await listSlotsByDate("2026-11-16", pool);
    // Link run_id to slot as would happen during a prior execution before crash
    await updateSlot(slot.id, { run_id: run.id }, pool);

    let generateCalled = false;
    const generateFn: GenerateCarouselFn = async () => {
      generateCalled = true;
      throw new Error("generateFn should NOT be called on crash idempotency");
    };

    let dispatchCalled = false;
    const dispatchFn: DispatchCarouselFn = async () => {
      dispatchCalled = true;
      throw new Error("dispatchFn should NOT be called on crash idempotency");
    };

    const tick = await runAutomationTick({
      pool,
      now,
      generateFn,
      dispatchFn,
    });
    assert.equal(tick.ran, true);
    assert.equal(generateCalled, false, "generateFn must not be called");
    assert.equal(dispatchCalled, false, "dispatchFn must not be called");

    const [slotAfter] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slotAfter.status, "done");
    assert.equal(slotAfter.channel, "telegram");
    assert.ok(slotAfter.finished_at);
  });

  // dispatchFn returns event.status='failed' without throwing -> enters handleRetry path
  it("when dispatchFn returns event.status='failed' without throwing, enters handleRetry path", async () => {
    await upsertAccount(
      {
        id: "acc-disp-failed-status",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: null,
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-disp-failed-status",
          channel: "telegram",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    const generateFn: GenerateCarouselFn = async (opts) => {
      return createTestRunInDb(opts.accountId);
    };

    let dispatchCalls = 0;
    const dispatchFn: DispatchCarouselFn = async (opts) => {
      dispatchCalls++;
      // Return status='failed' without throwing
      return {
        event: {
          id: `evt-failed-${dispatchCalls}`,
          run_id: opts.runId,
          channel: opts.channel,
          status: "failed",
          triggered_by: opts.triggeredBy || "auto_schedule",
          request_payload: {},
          response_payload: { error: "Telegram API rate limit 429" },
          sent_at: null,
          created_at: new Date().toISOString(),
        },
        run: {} as any,
      };
    };

    // First tick: attempt 1 -> enters retry, status remains pending at now+5min
    const tick1 = await runAutomationTick({
      pool,
      now,
      generateFn,
      dispatchFn,
    });
    assert.equal(tick1.ran, true);
    assert.equal(dispatchCalls, 1);

    const [slotAfter1] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slotAfter1.status, "pending");
    assert.equal(slotAfter1.attempts, 1);
    assert.equal(slotAfter1.last_error, "Telegram API rate limit 429");
    const retryTime = new Date(now.getTime() + 5 * 60 * 1000);
    assert.equal(slotAfter1.scheduled_at.getTime(), retryTime.getTime());
    assert.ok(slotAfter1.run_id);

    // Second tick at retryTime: attempt 2 -> status becomes failed
    const tick2 = await runAutomationTick({
      pool,
      now: retryTime,
      generateFn,
      dispatchFn,
    });
    assert.equal(tick2.ran, true);
    assert.equal(dispatchCalls, 2);

    const [slotAfter2] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slotAfter2.status, "failed");
    assert.equal(slotAfter2.attempts, 2);
    assert.equal(slotAfter2.last_error, "Telegram API rate limit 429");
    assert.ok(slotAfter2.finished_at);
  });

  it("slot with channel zernio is dispatched directly to zernio without awaiting approval", async () => {
    await upsertAccount(
      {
        id: "acc-zernio-direct",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: "ext-zernio-123",
        social_provider: "zernio",
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-zernio-direct",
          channel: "zernio",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    const generateFn: GenerateCarouselFn = async (opts) => {
      return createTestRunInDb(opts.accountId);
    };

    let dispatchedChannel: string | null = null;
    const customDispatchFn: DispatchCarouselFn = async (opts: any) => {
      dispatchedChannel = opts.channel;
      return {
        event: {
          id: "evt-zernio-1",
          run_id: opts.runId,
          channel: opts.channel,
          status: "sent",
          triggered_by: opts.triggeredBy || "auto_schedule",
          request_payload: {},
          response_payload: {},
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        run: {} as any,
      };
    };

    const notifications: Array<{ event: AutomationNotifyEvent; payload: NotifyPayload }> = [];
    const notifyFn: NotifyAutomationFn = async (event, payload) => {
      notifications.push({ event, payload });
    };

    await runAutomationTick({
      pool,
      now,
      generateFn,
      dispatchFn: customDispatchFn,
      notifyFn,
    });

    assert.equal(dispatchedChannel, "zernio");

    const [slot] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slot.status, "done");
    assert.equal(slot.channel, "zernio");
    assert.ok(slot.finished_at);

    const bufferAcceptedNotif = notifications.find((n) => n.event === "buffer_accepted");
    assert.ok(bufferAcceptedNotif, "buffer_accepted notification must be sent");
  });

  it("slot with channel zernio enters retry when dispatch fails", async () => {
    await upsertAccount(
      {
        id: "acc-zernio-fail",
        persona: "P1",
        role: "single_woman",
        enabled: true,
        auto_post_enabled: true,
        external_account_id: "ext-zernio-fail",
        social_provider: "zernio",
      },
      pool
    );

    const now = new Date("2026-11-16T10:00:00.000Z");
    const windowEnd = new Date("2026-11-16T12:00:00.000Z");

    await insertSlots(
      [
        {
          slot_date: "2026-11-16",
          window_id: "morning",
          account_id: "acc-zernio-fail",
          channel: "zernio",
          scheduled_at: now,
          window_end: windowEnd,
        },
      ],
      pool
    );

    const generateFn: GenerateCarouselFn = async (opts) => {
      return createTestRunInDb(opts.accountId);
    };

    const failingDispatchFn: DispatchCarouselFn = async (opts: any) => {
      return {
        event: {
          id: "evt-zernio-fail",
          run_id: opts.runId,
          channel: opts.channel,
          status: "failed",
          triggered_by: opts.triggeredBy || "auto_schedule",
          request_payload: {},
          response_payload: { error: "Zernio network timeout" },
          sent_at: null,
          created_at: new Date().toISOString(),
        },
        run: {} as any,
      };
    };

    const notifications: Array<{ event: AutomationNotifyEvent; payload: NotifyPayload }> = [];
    const notifyFn: NotifyAutomationFn = async (event, payload) => {
      notifications.push({ event, payload });
    };

    await runAutomationTick({
      pool,
      now,
      generateFn,
      dispatchFn: failingDispatchFn,
      notifyFn,
    });

    const [slot] = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slot.status, "pending");
    assert.equal(slot.attempts, 1);
    assert.equal(slot.last_error, "Zernio network timeout");

    const failedNotif = notifications.find((n) => n.event === "publish_failed");
    assert.ok(failedNotif, "publish_failed notification must be sent");
    assert.equal(failedNotif.payload.reason, "Zernio network timeout");
  });
});
