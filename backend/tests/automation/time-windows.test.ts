import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  localDateString,
  zonedTimeToUtc,
  addLocalDays,
} from "../../src/domain/automation/time.js";
import {
  DEFAULT_WINDOWS,
  PostWindow,
  resolveAutomationTimezone,
  resolvePostWindows,
  resolvePostCountPerDay,
  validatePostWindows,
} from "../../src/domain/automation/windows.js";

describe("domain/automation/time", () => {
  describe("localDateString", () => {
    it("formats UTC dates into local YYYY-MM-DD for America/Sao_Paulo (UTC-3)", () => {
      // 2026-11-16 01:00:00 UTC is 2026-11-15 22:00:00 in America/Sao_Paulo
      const date1 = new Date("2026-11-16T01:00:00Z");
      assert.equal(localDateString(date1, "America/Sao_Paulo"), "2026-11-15");

      // 2026-11-16 03:00:00 UTC is 2026-11-16 00:00:00 in America/Sao_Paulo
      const date2 = new Date("2026-11-16T03:00:00Z");
      assert.equal(localDateString(date2, "America/Sao_Paulo"), "2026-11-16");
    });

    it("formats UTC dates for other timezones like UTC or Asia/Tokyo", () => {
      const date = new Date("2026-11-16T16:00:00Z");
      assert.equal(localDateString(date, "UTC"), "2026-11-16");
      assert.equal(localDateString(date, "Asia/Tokyo"), "2026-11-17");
    });
  });

  describe("zonedTimeToUtc", () => {
    it("converts local date and HH:mm to exact UTC Date for America/Sao_Paulo (UTC-3)", () => {
      // 07:00 in America/Sao_Paulo (-03:00) -> 10:00 UTC
      const utc1 = zonedTimeToUtc("2026-11-16", "07:00", "America/Sao_Paulo");
      assert.equal(utc1.toISOString(), "2026-11-16T10:00:00.000Z");

      // 18:30 in America/Sao_Paulo (-03:00) -> 21:30 UTC
      const utc2 = zonedTimeToUtc("2026-11-16", "18:30", "America/Sao_Paulo");
      assert.equal(utc2.toISOString(), "2026-11-16T21:30:00.000Z");
    });

    it("converts correctly for UTC timezone", () => {
      const utc = zonedTimeToUtc("2026-11-16", "12:00", "UTC");
      assert.equal(utc.toISOString(), "2026-11-16T12:00:00.000Z");
    });

    it("handles DST transition timezone correctly via single-iteration offset refinement", () => {
      // In New York (America/New_York), DST ended on Nov 1, 2026 (EST is UTC-5)
      // and in July it was EDT (UTC-4).
      const utcWinter = zonedTimeToUtc("2026-12-01", "12:00", "America/New_York");
      assert.equal(utcWinter.toISOString(), "2026-12-01T17:00:00.000Z");

      const utcSummer = zonedTimeToUtc("2026-07-01", "12:00", "America/New_York");
      assert.equal(utcSummer.toISOString(), "2026-07-01T16:00:00.000Z");
    });
  });

  describe("addLocalDays", () => {
    it("adds days to YYYY-MM-DD string correctly across months and leap years", () => {
      assert.equal(addLocalDays("2026-11-16", 1), "2026-11-17");
      assert.equal(addLocalDays("2026-11-30", 1), "2026-12-01");
      assert.equal(addLocalDays("2026-12-31", 1), "2027-01-01");
      assert.equal(addLocalDays("2026-11-16", -1), "2026-11-15");
      assert.equal(addLocalDays("2024-02-28", 1), "2024-02-29");
    });
  });
});

describe("domain/automation/windows", () => {
  describe("DEFAULT_WINDOWS", () => {
    it("defines morning, midday, evening windows per spec §5.1", () => {
      assert.deepEqual(DEFAULT_WINDOWS, [
        { id: "morning", start: "07:00", end: "09:00" },
        { id: "midday", start: "11:30", end: "12:30" },
        { id: "evening", start: "18:00", end: "20:00" },
      ]);
    });
  });

  describe("resolveAutomationTimezone", () => {
    it("respects priority: settings.auto_post_timezone > env.AUTOMATION_TZ > env.TZ > America/Sao_Paulo", () => {
      // 1. Settings wins
      assert.equal(
        resolveAutomationTimezone(
          { auto_post_timezone: "America/Manaus" },
          { AUTOMATION_TZ: "UTC", TZ: "Asia/Tokyo" }
        ),
        "America/Manaus"
      );

      // 2. AUTOMATION_TZ wins if settings empty
      assert.equal(
        resolveAutomationTimezone(
          {},
          { AUTOMATION_TZ: "America/Recife", TZ: "Asia/Tokyo" }
        ),
        "America/Recife"
      );

      // 3. TZ wins if AUTOMATION_TZ empty
      assert.equal(
        resolveAutomationTimezone(
          {},
          { TZ: "America/Fortaleza" }
        ),
        "America/Fortaleza"
      );

      // 4. Fallback default
      assert.equal(
        resolveAutomationTimezone({}, {}),
        "America/Sao_Paulo"
      );
    });
  });

  describe("resolvePostWindows & validatePostWindows", () => {
    it("returns parsed windows from settings.auto_post_windows if valid", () => {
      const custom: PostWindow[] = [
        { id: "early", start: "06:00", end: "08:00" },
        { id: "late", start: "21:00", end: "23:00" },
      ];
      assert.deepEqual(
        resolvePostWindows({ auto_post_windows: custom }),
        custom
      );
    });

    it("parses JSON string if auto_post_windows is a JSON string", () => {
      const custom: PostWindow[] = [
        { id: "early", start: "06:00", end: "08:00" },
      ];
      assert.deepEqual(
        resolvePostWindows({ auto_post_windows: JSON.stringify(custom) }),
        custom
      );
    });

    it("falls back to env.AUTO_POST_WINDOWS if settings is empty", () => {
      const custom: PostWindow[] = [
        { id: "midday_only", start: "12:00", end: "14:00" },
      ];
      assert.deepEqual(
        resolvePostWindows({}, { AUTO_POST_WINDOWS: JSON.stringify(custom) }),
        custom
      );
    });

    it("falls back to DEFAULT_WINDOWS when setting and env are empty or invalid", () => {
      assert.deepEqual(resolvePostWindows({}), DEFAULT_WINDOWS);
      assert.deepEqual(resolvePostWindows({ auto_post_windows: "invalid json" }), DEFAULT_WINDOWS);
      assert.deepEqual(resolvePostWindows({ auto_post_windows: [] }), DEFAULT_WINDOWS);
    });

    it("validatePostWindows rejects invalid shapes and start >= end", () => {
      assert.equal(validatePostWindows(DEFAULT_WINDOWS), true);

      assert.throws(() => {
        validatePostWindows([
          { id: "bad", start: "10:00", end: "09:00" } as PostWindow,
        ]);
      }, /start must be before end/);

      assert.throws(() => {
        validatePostWindows([
          { id: "bad_equal", start: "10:00", end: "10:00" } as PostWindow,
        ]);
      }, /start must be before end/);

      assert.throws(() => {
        validatePostWindows([
          { id: "", start: "10:00", end: "11:00" } as PostWindow,
        ]);
      }, /invalid window format/);

      assert.throws(() => {
        validatePostWindows([
          { id: "bad_time", start: "25:00", end: "26:00" } as PostWindow,
        ]);
      }, /invalid time format/);
    });
  });

  describe("resolvePostCountPerDay", () => {
    it("returns default 3 if setting is null/undefined/invalid", () => {
      assert.equal(resolvePostCountPerDay(), 3);
      assert.equal(resolvePostCountPerDay({}), 3);
      assert.equal(resolvePostCountPerDay({ auto_post_count_per_day: null }), 3);
      assert.equal(resolvePostCountPerDay({ auto_post_count_per_day: "invalid" as any }), 3);
    });

    it("clamps value between 1 and 6", () => {
      assert.equal(resolvePostCountPerDay({ auto_post_count_per_day: 0 }), 1);
      assert.equal(resolvePostCountPerDay({ auto_post_count_per_day: -5 }), 1);
      assert.equal(resolvePostCountPerDay({ auto_post_count_per_day: 1 }), 1);
      assert.equal(resolvePostCountPerDay({ auto_post_count_per_day: 4 }), 4);
      assert.equal(resolvePostCountPerDay({ auto_post_count_per_day: 6 }), 6);
      assert.equal(resolvePostCountPerDay({ auto_post_count_per_day: 10 }), 6);
    });

    it("parses numeric strings properly", () => {
      assert.equal(resolvePostCountPerDay({ auto_post_count_per_day: "2" as any }), 2);
    });
  });
});
