import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { buildApp } from "../../src/app.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { createCarouselRun } from "../../src/domain/runs/store.js";
import { insertSlots } from "../../src/domain/automation/slots.js";
import { setSetting } from "../../src/domain/settings/store.js";

const { Pool } = pg;

describe("Task 8: Schedule read API + settings validation (spec §5.7 / §5.8)", { timeout: 60000 }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  const testToken = "test-schedule-token";
  const authHeaders = { authorization: `Bearer ${testToken}` };

  before(async () => {
    process.env.API_TOKEN = testToken;
    const connectionString =
      process.env.DATABASE_URL ||
      "postgresql://luisfelipe@localhost:5432/redhorse_test";
    process.env.DATABASE_URL = connectionString;
    pool = new Pool({ connectionString });
    await runMigrations(pool);
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    await closePool();
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM tiktok_posts");
    await pool.query("DELETE FROM carousel_slides");
    await pool.query("DELETE FROM carousel_runs");
    await pool.query("DELETE FROM auto_post_slots");
    await pool.query("DELETE FROM accounts");
    await pool.query("DELETE FROM app_settings");
  });

  describe("GET /api/v1/automation/schedule", () => {
    it("returns 400 validation_error for invalid date format or invalid calendar date", async () => {
      const invalidDates = [
        "not-a-date",
        "2026-13-01",
        "2026-02-30",
        "2026-00-10",
        "16-11-2026",
        "2026/11/16",
      ];

      for (const d of invalidDates) {
        const res = await app.inject({
          method: "GET",
          url: `/api/v1/automation/schedule?date=${encodeURIComponent(d)}`,
          headers: authHeaders,
        });

        assert.equal(res.statusCode, 400, `Expected 400 for date: ${d}`);
        const body = JSON.parse(res.body);
        assert.equal(body.error, "validation_error");
      }
    });

    it("is strictly read-only and does not create slots when queried on an empty day", async () => {
      await upsertAccount(
        {
          id: "acc_active",
          role: "single_woman",
          enabled: true,
          persona: "Criadora de moda",
        },
        pool
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/automation/schedule?date=2026-11-20",
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.date, "2026-11-20");
      assert.deepEqual(data.slots, []);

      // Verify no rows created in auto_post_slots
      const countRes = await pool.query(
        "SELECT COUNT(*)::int AS cnt FROM auto_post_slots"
      );
      assert.equal(countRes.rows[0].cnt, 0);
    });

    it("defaults date to today in automation timezone when date param is omitted", async () => {
      await setSetting("auto_post_timezone", "America/Sao_Paulo", pool);
      await setSetting("auto_dispatch_enabled", true, pool);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/automation/schedule",
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(typeof data.date, "string");
      assert.match(data.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(data.timezone, "America/Sao_Paulo");
      assert.equal(data.enabled, true);
      assert.ok(Array.isArray(data.slots));
    });

    it("returns joined slot shape with account_display_name, account_enabled, run_status, post_status", async () => {
      await setSetting("auto_dispatch_enabled", true, pool);

      // Account 1: Enabled with display_name
      await upsertAccount(
        {
          id: "acc_gabriel",
          display_name: "Gabriel",
          role: "single_man",
          enabled: true,
          persona: "Estilo masculino",
        },
        pool
      );

      // Account 2: Disabled without display_name
      await upsertAccount(
        {
          id: "acc_disabled",
          role: "single_woman",
          enabled: false,
          persona: "Estilo feminino",
        },
        pool
      );

      // Create Run for slot 1
      const run = await createCarouselRun(
        {
          account_id: "acc_gabriel",
          account_role: "single_man",
          archetype_title: "Homem Elegante",
          tema: "Tendências",
          bait_body: "Como se vestir bem",
          legenda: "Legenda do carrossel #estilo",
          status: "published",
        },
        pool
      );

      // Create TikTok post with publish_status for run
      await pool.query(
        `INSERT INTO tiktok_posts (run_id, tracking_mode, publish_status)
         VALUES ($1, 'manual', 'published')`,
        [run.id]
      );

      const slotDate = "2026-11-16";
      await insertSlots(
        [
          {
            slot_date: slotDate,
            window_id: "morning",
            account_id: "acc_gabriel",
            channel: "zernio",
            scheduled_at: new Date("2026-11-16T10:17:00.000Z"),
            window_end: new Date("2026-11-16T12:00:00.000Z"),
            status: "done",
          },
          {
            slot_date: slotDate,
            window_id: "midday",
            account_id: "acc_disabled",
            channel: "telegram",
            scheduled_at: new Date("2026-11-16T14:30:00.000Z"),
            window_end: new Date("2026-11-16T15:30:00.000Z"),
            status: "pending",
          },
        ],
        pool
      );

      // Attach run_id to slot 1
      const slotsInDb = await pool.query(
        "SELECT id FROM auto_post_slots WHERE account_id = 'acc_gabriel'"
      );
      const slot1Id = slotsInDb.rows[0].id;
      await pool.query(
        "UPDATE auto_post_slots SET run_id = $1 WHERE id = $2",
        [run.id, slot1Id]
      );
      await pool.query(
        "UPDATE carousel_runs SET auto_post_slot_id = $1 WHERE id = $2",
        [slot1Id, run.id]
      );

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/automation/schedule?date=${slotDate}`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.date, "2026-11-16");
      assert.equal(data.enabled, true);
      assert.equal(data.slots.length, 2);

      // Slot 1
      const s1 = data.slots[0];
      assert.equal(s1.id, slot1Id);
      assert.equal(s1.window_id, "morning");
      assert.equal(s1.account_id, "acc_gabriel");
      assert.equal(s1.account_display_name, "Gabriel");
      assert.equal(s1.account_enabled, true);
      assert.equal(s1.channel, "zernio");
      assert.equal(s1.status, "done");
      assert.equal(s1.run_id, run.id);
      assert.equal(s1.run_status, "published");
      assert.equal(s1.post_status, "published");
      assert.equal(s1.last_error, null);

      // Slot 2
      const s2 = data.slots[1];
      assert.equal(s2.window_id, "midday");
      assert.equal(s2.account_id, "acc_disabled");
      assert.equal(s2.account_display_name, "acc_disabled"); // fallback to account_id
      assert.equal(s2.account_enabled, false);
      assert.equal(s2.channel, "telegram");
      assert.equal(s2.status, "pending");
      assert.equal(s2.run_id, null);
      assert.equal(s2.run_status, null);
      assert.equal(s2.post_status, null);
    });
  });

  describe("PUT /api/v1/settings validation", () => {
    describe("auto_post_windows validation", () => {
      it("accepts valid windows array", async () => {
        const validWindows = [
          { id: "morning", start: "07:00", end: "09:00" },
          { id: "evening", start: "18:00", end: "20:00" },
        ];

        const res = await app.inject({
          method: "PUT",
          url: "/api/v1/settings/auto_post_windows",
          headers: authHeaders,
          payload: { value: validWindows },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.deepEqual(body.value, validWindows);
      });

      it("rejects invalid windows when start >= end with 400 validation_error", async () => {
        const invalidWindows = [
          { id: "morning", start: "09:00", end: "07:00" },
        ];

        const res = await app.inject({
          method: "PUT",
          url: "/api/v1/settings/auto_post_windows",
          headers: authHeaders,
          payload: { value: invalidWindows },
        });

        assert.equal(res.statusCode, 400);
        const body = JSON.parse(res.body);
        assert.equal(body.error, "validation_error");
      });

      it("rejects malformed windows (not array, empty array, bad times) with 400 validation_error", async () => {
        const malformedCases = [
          [],
          "not-array",
          [{ id: "m", start: "bad-time", end: "09:00" }],
          [{ id: "", start: "07:00", end: "09:00" }],
          [{ start: "07:00", end: "09:00" }],
        ];

        for (const val of malformedCases) {
          const res = await app.inject({
            method: "PUT",
            url: "/api/v1/settings/auto_post_windows",
            headers: authHeaders,
            payload: { value: val },
          });

          assert.equal(res.statusCode, 400);
          const body = JSON.parse(res.body);
          assert.equal(body.error, "validation_error");
        }
      });
    });

    describe("auto_post_count_per_day validation", () => {
      it("accepts valid count between 1 and 6", async () => {
        for (const count of [1, 3, 6]) {
          const res = await app.inject({
            method: "PUT",
            url: "/api/v1/settings/auto_post_count_per_day",
            headers: authHeaders,
            payload: { value: count },
          });

          assert.equal(res.statusCode, 200);
          const body = JSON.parse(res.body);
          assert.equal(body.value, count);
        }
      });

      it("rejects counts outside 1..6 or non-integers with 400 validation_error", async () => {
        const invalidCounts = [0, 7, -1, 2.5, "three", null];

        for (const val of invalidCounts) {
          const res = await app.inject({
            method: "PUT",
            url: "/api/v1/settings/auto_post_count_per_day",
            headers: authHeaders,
            payload: { value: val },
          });

          assert.equal(res.statusCode, 400, `Expected 400 for count: ${val}`);
          const body = JSON.parse(res.body);
          assert.equal(body.error, "validation_error");
        }
      });
    });

    describe("auto_post_timezone validation", () => {
      it("accepts valid non-empty string timezone", async () => {
        const res = await app.inject({
          method: "PUT",
          url: "/api/v1/settings/auto_post_timezone",
          headers: authHeaders,
          payload: { value: "America/Sao_Paulo" },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.value, "America/Sao_Paulo");
      });

      it("rejects empty string, whitespace-only or non-string with 400 validation_error", async () => {
        const invalidTz = ["", "   ", null, 123];

        for (const val of invalidTz) {
          const res = await app.inject({
            method: "PUT",
            url: "/api/v1/settings/auto_post_timezone",
            headers: authHeaders,
            payload: { value: val },
          });

          assert.equal(res.statusCode, 400, `Expected 400 for tz: ${val}`);
          const body = JSON.parse(res.body);
          assert.equal(body.error, "validation_error");
        }
      });
    });
  });
});
