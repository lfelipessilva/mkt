import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import {
  createCarouselRun,
  getCarouselRun,
  listCarouselRuns,
} from "../../src/domain/runs/store.js";

const { Pool } = pg;

describe("Task 9: Read model buffer_dispatched_at (spec §5.8)", { timeout: 60000 }, () => {
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
    await closePool();
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM dispatch_events");
    await pool.query("DELETE FROM carousel_slides");
    await pool.query("DELETE FROM carousel_runs");
    await pool.query("DELETE FROM auto_post_slots");
    await pool.query("DELETE FROM accounts");
  });

  it("returns null for buffer_dispatched_at when no dispatch events exist", async () => {
    await upsertAccount(
      {
        id: "acc_test",
        role: "single_woman",
        enabled: true,
      },
      pool
    );

    const created = await createCarouselRun(
      {
        account_id: "acc_test",
        account_role: "single_woman",
        archetype_title: "Test Archetype",
        legenda: "Legenda teste",
        status: "generated",
      },
      pool
    );

    const run = await getCarouselRun(created.id, pool);
    assert.ok(run);
    assert.equal(run.buffer_dispatched_at, null);

    const list = await listCarouselRuns({ accountId: "acc_test" }, pool);
    assert.equal(list.length, 1);
    assert.equal(list[0].buffer_dispatched_at, null);
  });

  it("returns null when dispatch event is telegram or api", async () => {
    await upsertAccount(
      {
        id: "acc_test",
        role: "single_woman",
        enabled: true,
      },
      pool
    );

    const created = await createCarouselRun(
      {
        account_id: "acc_test",
        account_role: "single_woman",
        archetype_title: "Test Archetype",
        legenda: "Legenda teste",
        status: "generated",
      },
      pool
    );

    const sentAt = new Date("2026-11-16T10:00:00.000Z");
    await pool.query(
      `INSERT INTO dispatch_events (run_id, channel, status, triggered_by, sent_at)
       VALUES ($1, 'telegram', 'sent', 'test', $2)`,
      [created.id, sentAt]
    );

    const run = await getCarouselRun(created.id, pool);
    assert.ok(run);
    assert.equal(run.buffer_dispatched_at, null);

    const list = await listCarouselRuns({ accountId: "acc_test" }, pool);
    assert.equal(list.length, 1);
    assert.equal(list[0].buffer_dispatched_at, null);
  });

  it("returns null when buffer dispatch event status is not sent", async () => {
    await upsertAccount(
      {
        id: "acc_test",
        role: "single_woman",
        enabled: true,
      },
      pool
    );

    const created = await createCarouselRun(
      {
        account_id: "acc_test",
        account_role: "single_woman",
        archetype_title: "Test Archetype",
        legenda: "Legenda teste",
        status: "generated",
      },
      pool
    );

    await pool.query(
      `INSERT INTO dispatch_events (run_id, channel, status, triggered_by, sent_at)
       VALUES ($1, 'buffer', 'failed', 'test', NOW())`,
      [created.id]
    );

    const run = await getCarouselRun(created.id, pool);
    assert.ok(run);
    assert.equal(run.buffer_dispatched_at, null);

    const list = await listCarouselRuns({ accountId: "acc_test" }, pool);
    assert.equal(list.length, 1);
    assert.equal(list[0].buffer_dispatched_at, null);
  });

  it("returns latest sent_at when buffer or social dispatch event has status sent", async () => {
    await upsertAccount(
      {
        id: "acc_test",
        role: "single_woman",
        enabled: true,
      },
      pool
    );

    const created = await createCarouselRun(
      {
        account_id: "acc_test",
        account_role: "single_woman",
        archetype_title: "Test Archetype",
        legenda: "Legenda teste",
        status: "generated",
      },
      pool
    );

    const firstSent = new Date("2026-11-16T10:00:00.000Z");
    const latestSent = new Date("2026-11-16T11:00:00.000Z");

    await pool.query(
      `INSERT INTO dispatch_events (run_id, channel, status, triggered_by, sent_at)
       VALUES ($1, 'social', 'sent', 'test', $2)`,
      [created.id, firstSent]
    );

    await pool.query(
      `INSERT INTO dispatch_events (run_id, channel, status, triggered_by, sent_at)
       VALUES ($1, 'buffer', 'sent', 'test', $2)`,
      [created.id, latestSent]
    );

    const run = await getCarouselRun(created.id, pool);
    assert.ok(run);
    assert.ok(run.buffer_dispatched_at instanceof Date);
    assert.equal(run.buffer_dispatched_at.toISOString(), latestSent.toISOString());

    const list = await listCarouselRuns({ accountId: "acc_test" }, pool);
    assert.equal(list.length, 1);
    assert.ok(list[0].buffer_dispatched_at instanceof Date);
    assert.equal(list[0].buffer_dispatched_at.toISOString(), latestSent.toISOString());
  });

  it("maps auto_post_slot_id if present on carousel_runs", async () => {
    await upsertAccount(
      {
        id: "acc_test",
        role: "single_woman",
        enabled: true,
      },
      pool
    );

    const created = await createCarouselRun(
      {
        account_id: "acc_test",
        account_role: "single_woman",
        archetype_title: "Test Archetype",
        legenda: "Legenda teste",
        status: "generated",
      },
      pool
    );

    const slotResult = await pool.query(
      `INSERT INTO auto_post_slots (
        slot_date, window_id, account_id, channel, scheduled_at, window_end, status
       ) VALUES (
        '2026-11-16', 'morning', 'acc_test', 'buffer', NOW(), NOW() + interval '1 hour', 'pending'
       ) RETURNING id`
    );
    const slotId = slotResult.rows[0].id;

    await pool.query(
      "UPDATE carousel_runs SET auto_post_slot_id = $1 WHERE id = $2",
      [slotId, created.id]
    );

    const run = await getCarouselRun(created.id, pool);
    assert.ok(run);
    assert.equal(run.auto_post_slot_id, slotId);

    const list = await listCarouselRuns({ accountId: "acc_test" }, pool);
    assert.equal(list.length, 1);
    assert.equal(list[0].auto_post_slot_id, slotId);
  });
});
