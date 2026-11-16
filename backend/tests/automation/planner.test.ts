import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { setSetting } from "../../src/domain/settings/store.js";
import { ensureDailyPlan } from "../../src/domain/automation/planner.js";
import { listSlotsByDate } from "../../src/domain/automation/slots.js";

const { Pool } = pg;

describe("Task 3: Planner & Slots (spec §5.11 items 1–6, 25–26)", { timeout: 90000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;

  before(async () => {
    let connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      connectionString = container.getConnectionUri();
    }
    process.env.DATABASE_URL = connectionString;
    pool = new Pool({ connectionString });
    await runMigrations(pool);
  });

  after(async () => {
    await closePool();
    if (pool) await pool.end();
    if (container) await container.stop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM auto_post_slots");
    await pool.query("DELETE FROM accounts");
    await pool.query("DELETE FROM app_settings");
    // Explicitly enable auto_dispatch_enabled by default in tests that require it
    await setSetting("auto_dispatch_enabled", true, pool);
  });

  // Spec §5.11 Item 1: 3 contas na janela 7h–9h → 3 slots, um por conta, horários dentro da janela e cada horário na sua fatia (ordenados: fatia 0, 1, 2).
  // Also verifies planned channel mapping.
  it("Item 1: 3 accounts in 7h-9h window -> 3 slots, one per account, ordered by slice and correct channel", async () => {
    // Setup 3 accounts with different channel configurations
    // Account 1: external_account_id present, provider buffer -> channel buffer
    await upsertAccount({
      id: "acc-1",
      persona: "P1",
      role: "single_woman",
      enabled: true,
      auto_post_enabled: true,
      external_account_id: "ext-buffer-1",
      social_provider: "zernio",
    }, pool);

    // Account 2: external_account_id present, provider postforme -> channel social
    await upsertAccount({
      id: "acc-2",
      persona: "P2",
      role: "single_woman",
      enabled: true,
      auto_post_enabled: true,
      external_account_id: "ext-postforme-2",
      social_provider: "postforme",
    }, pool);

    // Account 3: no external_account_id -> channel telegram
    await upsertAccount({
      id: "acc-3",
      persona: "P3",
      role: "single_woman",
      enabled: true,
      auto_post_enabled: true,
      external_account_id: null,
      social_provider: null,
    }, pool);

    // Configure 1 window only (morning 07:00-09:00) to isolate window slicing test
    await setSetting("auto_post_windows", [
      { id: "morning", start: "07:00", end: "09:00" },
    ], pool);
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);

    // Simulated now: 2026-11-16 06:00:00 Sao Paulo (UTC-3 => 09:00:00 UTC)
    const now = new Date("2026-11-16T09:00:00.000Z");

    // Deterministic randomInt: Fisher-Yates gets 0 (identity order), offsets get 10 minutes (600,000 ms)
    const result = await ensureDailyPlan({
      pool,
      now,
      randomInt: (max) => Math.min(10 * 60 * 1000, max > 0 ? max - 1 : 0),
    });

    assert.equal(result.created, 3, "should create exactly 3 slots");
    assert.equal(result.skippedExpired, 0);

    const slots = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slots.length, 3);

    // Verify channels
    const slotByAccount = new Map(slots.map(s => [s.account_id, s]));
    assert.equal(slotByAccount.get("acc-1")?.channel, "zernio");
    assert.equal(slotByAccount.get("acc-2")?.channel, "social");
    assert.equal(slotByAccount.get("acc-3")?.channel, "telegram");

    // Slices for 7h-9h (120 min total, 3 accounts => 40 min segment each):
    // Fatia 0: 07:00 to 07:40 Sao Paulo (10:00 to 10:40 UTC)
    // Fatia 1: 07:40 to 08:20 Sao Paulo (10:40 to 11:20 UTC)
    // Fatia 2: 08:20 to 09:00 Sao Paulo (11:20 to 12:00 UTC)
    const sortedSlots = [...slots].sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime());

    // Window boundaries in UTC
    const slice0Start = new Date("2026-11-16T10:00:00.000Z").getTime();
    const slice1Start = new Date("2026-11-16T10:40:00.000Z").getTime();
    const slice2Start = new Date("2026-11-16T11:20:00.000Z").getTime();
    const windowEnd = new Date("2026-11-16T12:00:00.000Z").getTime();

    // Slot in slice 0
    assert.ok(sortedSlots[0].scheduled_at.getTime() >= slice0Start, "slot 0 >= 07:00");
    assert.ok(sortedSlots[0].scheduled_at.getTime() < slice1Start, "slot 0 < 07:40");

    // Slot in slice 1
    assert.ok(sortedSlots[1].scheduled_at.getTime() >= slice1Start, "slot 1 >= 07:40");
    assert.ok(sortedSlots[1].scheduled_at.getTime() < slice2Start, "slot 1 < 08:20");

    // Slot in slice 2
    assert.ok(sortedSlots[2].scheduled_at.getTime() >= slice2Start, "slot 2 >= 08:20");
    assert.ok(sortedSlots[2].scheduled_at.getTime() <= windowEnd - 60000, "slot 2 <= 08:59");

    // Strictly ordered
    assert.ok(sortedSlots[0].scheduled_at.getTime() < sortedSlots[1].scheduled_at.getTime());
    assert.ok(sortedSlots[1].scheduled_at.getTime() < sortedSlots[2].scheduled_at.getTime());
  });

  // Spec §5.11 Item 2: idempotência — rodar duas vezes no mesmo dia não duplica slots.
  it("Item 2: idempotency — running twice on the same day does not duplicate slots", async () => {
    await upsertAccount({ id: "acc-1", persona: "P1", role: "single_woman", enabled: true, auto_post_enabled: true }, pool);
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);

    const now = new Date("2026-11-16T09:00:00.000Z"); // 06:00 Sao Paulo

    const firstRun = await ensureDailyPlan({ pool, now });
    assert.equal(firstRun.created, 3, "first run should create 3 slots (one for each of the 3 default windows)");

    const secondRun = await ensureDailyPlan({ pool, now });
    assert.equal(secondRun.created, 0, "second run should create 0 slots");

    const slots = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slots.length, 3, "total slots must still be 3");
  });

  // Spec §5.11 Item 3: boot ao meio-dia → janelas passadas não geram slots; janela da noite gera; nenhum scheduled_at no passado.
  it("Item 3: boot at midday -> past windows generate no slots, evening window generates, no scheduled_at in the past", async () => {
    await upsertAccount({ id: "acc-1", persona: "P1", role: "single_woman", enabled: true, auto_post_enabled: true }, pool);
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);

    // Midday: 12:00:00 Sao Paulo (15:00:00 UTC)
    // Default windows:
    // morning: 07:00-09:00 (past)
    // midday: 11:30-12:30 (active, windowEnd 12:30 > 12:00, remaining 25 min >= 5 min)
    // evening: 18:00-20:00 (future)
    const now = new Date("2026-11-16T15:00:00.000Z");

    const result = await ensureDailyPlan({ pool, now });
    // morning is past (windowEnd < now) -> not created.
    // midday (windowEnd 12:30 > 12:00) -> created.
    // evening (windowEnd 20:00 > 12:00) -> created.
    assert.equal(result.created, 2, "only midday and evening windows should be created");

    const slots = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slots.length, 2);

    for (const slot of slots) {
      assert.notEqual(slot.window_id, "morning", "morning slot must not exist");
      assert.ok(slot.scheduled_at.getTime() >= now.getTime(), "scheduled_at must not be in the past");
    }
  });

  // Spec §5.11 Item 4: conta nova no meio do dia → slots só em janelas futuras.
  it("Item 4: new account created midday -> receives slots only in future windows", async () => {
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);

    // Initial account created in the morning
    await upsertAccount({ id: "acc-old", persona: "Old", role: "single_woman", enabled: true, auto_post_enabled: true }, pool);
    const morningTime = new Date("2026-11-16T09:00:00.000Z"); // 06:00 Sao Paulo
    await ensureDailyPlan({ pool, now: morningTime });

    // Midday at 13:00 Sao Paulo (16:00 UTC)
    // morning (07-09) and midday (11:30-12:30) have ended. Evening (18-20) remains.
    const middayNow = new Date("2026-11-16T16:00:00.000Z");

    // Insert new account
    await upsertAccount({ id: "acc-new", persona: "New", role: "single_woman", enabled: true, auto_post_enabled: true }, pool);

    // Run ensureDailyPlan again
    const result = await ensureDailyPlan({ pool, now: middayNow });
    assert.equal(result.created, 1, "only 1 slot created for new account in evening window");

    const slots = await listSlotsByDate("2026-11-16", pool);
    const newAccountSlots = slots.filter(s => s.account_id === "acc-new");
    assert.equal(newAccountSlots.length, 1);
    assert.equal(newAccountSlots[0].window_id, "evening");
    assert.ok(newAccountSlots[0].scheduled_at.getTime() > middayNow.getTime());
  });

  // Spec §5.11 Item 5: conta desabilitada → não recebe slots novos; slots futuros existentes ficam pending e são pulados na execução se continuar desabilitada.
  it("Item 5: disabled account (enabled=false) does not receive new slots", async () => {
    await upsertAccount({ id: "acc-disabled", persona: "P", role: "single_woman", enabled: false, auto_post_enabled: true }, pool);
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);

    const now = new Date("2026-11-16T09:00:00.000Z"); // 06:00 Sao Paulo
    const result = await ensureDailyPlan({ pool, now });

    assert.equal(result.created, 0, "disabled account should not receive any slots");
    const slots = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slots.length, 0);
  });

  // Spec §5.11 Item 6: auto_dispatch_enabled = false → não cria slots novos, mas slots futuros existentes continuam pending; ao religar, executam; slots de janela vencida viram skipped.
  it("Item 6: auto_dispatch_enabled=false does not create new slots, existing pending slots remain, overdue slots are skipped", async () => {
    await upsertAccount({ id: "acc-1", persona: "P1", role: "single_woman", enabled: true, auto_post_enabled: true }, pool);
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);

    // 1. Initial plan created when enabled
    const morningNow = new Date("2026-11-16T09:00:00.000Z"); // 06:00 Sao Paulo
    await ensureDailyPlan({ pool, now: morningNow });
    let slots = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slots.length, 3);
    assert.ok(slots.every(s => s.status === "pending"));

    // 2. Toggle off: auto_dispatch_enabled = false
    await setSetting("auto_dispatch_enabled", false, pool);

    // Fast-forward to 10:00 Sao Paulo (13:00 UTC) - morning window ended at 09:00 Sao Paulo (12:00 UTC)
    const afterMorningNow = new Date("2026-11-16T13:00:00.000Z");
    const disabledPlanResult = await ensureDailyPlan({ pool, now: afterMorningNow });

    assert.equal(disabledPlanResult.created, 0, "should not create slots when auto_dispatch_enabled is false");
    assert.equal(disabledPlanResult.skippedExpired, 1, "should mark overdue morning slot as skipped");

    slots = await listSlotsByDate("2026-11-16", pool);
    const morningSlot = slots.find(s => s.window_id === "morning");
    assert.equal(morningSlot?.status, "skipped");
    assert.equal(morningSlot?.last_error, "janela encerrada");

    // Future slots (midday and evening) must still be pending
    const middaySlot = slots.find(s => s.window_id === "midday");
    const eveningSlot = slots.find(s => s.window_id === "evening");
    assert.equal(middaySlot?.status, "pending");
    assert.equal(eveningSlot?.status, "pending");

    // 3. Re-enable: auto_dispatch_enabled = true
    await setSetting("auto_dispatch_enabled", true, pool);
    const reenabledResult = await ensureDailyPlan({ pool, now: afterMorningNow });
    assert.equal(reenabledResult.created, 0, "future slots were already created, so 0 newly created");

    // Slots still pending
    slots = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slots.find(s => s.window_id === "midday")?.status, "pending");
    assert.equal(slots.find(s => s.window_id === "evening")?.status, "pending");
  });

  // Spec §5.11 Item 25: conta com auto_post_enabled = false não recebe slot.
  it("Item 25: account with auto_post_enabled=false does not receive slots", async () => {
    await upsertAccount({ id: "acc-opt-out", persona: "OptOut", role: "single_woman", enabled: true, auto_post_enabled: false }, pool);
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);

    const now = new Date("2026-11-16T09:00:00.000Z");
    const result = await ensureDailyPlan({ pool, now });

    assert.equal(result.created, 0, "account with auto_post_enabled=false should not receive any slots");
    const slots = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slots.length, 0);
  });

  // Spec §5.11 Item 26: auto_post_count_per_day = 2 → só 2 janelas por conta.
  it("Item 26: auto_post_count_per_day=2 generates slots only in the first 2 windows", async () => {
    await upsertAccount({ id: "acc-1", persona: "P1", role: "single_woman", enabled: true, auto_post_enabled: true }, pool);
    await setSetting("auto_post_count_per_day", 2, pool);
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);

    const now = new Date("2026-11-16T09:00:00.000Z"); // 06:00 Sao Paulo
    const result = await ensureDailyPlan({ pool, now });

    assert.equal(result.created, 2, "only 2 slots should be created");

    const slots = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slots.length, 2);

    const windowIds = slots.map(s => s.window_id);
    assert.ok(windowIds.includes("morning"), "should include first window (morning)");
    assert.ok(windowIds.includes("midday"), "should include second window (midday)");
    assert.ok(!windowIds.includes("evening"), "should NOT include third window (evening)");
  });

  // Additional test: window with < 5 min remaining creates slot marked skipped with 'janela sem tempo hábil'
  it("creates slot with status='skipped' and 'janela sem tempo hábil' if less than 5 min remain in window", async () => {
    await upsertAccount({ id: "acc-1", persona: "P1", role: "single_woman", enabled: true, auto_post_enabled: true }, pool);
    await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);
    await setSetting("auto_post_windows", [
      { id: "morning", start: "07:00", end: "09:00" },
    ], pool);

    // Window ends at 09:00 Sao Paulo (12:00 UTC).
    // Now is 08:56 Sao Paulo (11:56 UTC).
    // availableStart = max(07:00, 08:56 + 5min = 09:01) = 09:01.
    // availableEnd - availableStart < 5min!
    const now = new Date("2026-11-16T11:56:00.000Z");
    const result = await ensureDailyPlan({ pool, now });

    assert.equal(result.created, 1);
    const slots = await listSlotsByDate("2026-11-16", pool);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].status, "skipped");
    assert.equal(slots[0].last_error, "janela sem tempo hábil");
  });
});
