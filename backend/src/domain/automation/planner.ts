import crypto from "node:crypto";
import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { getAllSettings, getSetting } from "../settings/store.js";
import { localDateString, zonedTimeToUtc } from "./time.js";
import {
  resolveAutomationTimezone,
  resolvePostCountPerDay,
  resolvePostWindows,
} from "./windows.js";
import {
  expireOverduePendingSlots,
  insertSlots,
  type InsertSlotInput,
  type SlotChannel,
} from "./slots.js";

export interface EnsureDailyPlanOptions {
  pool?: Pool;
  now?: Date;
  randomInt?: (max: number) => number;
}

export interface EnsureDailyPlanResult {
  created: number;
  skippedExpired: number;
}

interface AccountRow {
  id: string;
  external_account_id: string | null;
  social_provider: string | null;
}

/**
 * Resolves the planned channel for an account:
 * - 'zernio' if external_account_id is present and provider is 'zernio'
 * - 'social' if external_account_id is present and provider is 'postforme'
 * - 'telegram' otherwise
 */
export function resolvePlannedChannel(account: {
  external_account_id?: string | null;
  social_provider?: string | null;
}): SlotChannel {
  const extId = account.external_account_id?.trim();
  if (extId) {
    const provider = account.social_provider?.trim().toLowerCase();
    if (provider === "zernio") return "zernio";
    if (provider === "postforme") return "social";
  }
  return "telegram";
}

/**
 * Generates the daily auto-post schedule according to spec §5.1 / §5.3:
 * 1. Expire overdue pending slots (window_end < now or slot_date < today) -> 'skipped' ('janela encerrada').
 * 2. If auto_dispatch_enabled is false / missing, stop after expiration.
 * 3. For each active window where windowEnd > now:
 *    - Find enabled and auto_post_enabled accounts that do not yet have a slot for (slot_date, window_id).
 *    - If window has < 5 min remaining, insert slots as 'skipped' ('janela sem tempo hábil').
 *    - Otherwise, shuffle accounts via Fisher-Yates and assign equal slices.
 * 4. Insert slots with ON CONFLICT (slot_date, window_id, account_id) DO NOTHING.
 */
export async function ensureDailyPlan(
  options: EnsureDailyPlanOptions = {}
): Promise<EnsureDailyPlanResult> {
  const p = options.pool || getPool();
  const now = options.now || new Date();
  const rand =
    options.randomInt ||
    ((max: number) => (max > 0 ? crypto.randomInt(max) : 0));

  const allSettings = await getAllSettings(p);
  const tz = resolveAutomationTimezone(allSettings);
  const today = localDateString(now, tz);

  // 1. Expire overdue pending slots
  const skippedExpired = await expireOverduePendingSlots(
    { now, today },
    p
  );

  // 2. Check auto_dispatch_enabled (missing defaults to false)
  const autoDispatchSetting = await getSetting<boolean>(
    "auto_dispatch_enabled",
    p
  );
  const autoDispatchEnabled = autoDispatchSetting === true;
  if (!autoDispatchEnabled) {
    return { created: 0, skippedExpired };
  }

  // 3. Resolve windows and count per day
  const allWindows = resolvePostWindows(allSettings);
  const countPerDay = resolvePostCountPerDay(allSettings);
  const windows = allWindows.slice(0, countPerDay);

  let createdTotal = 0;

  for (const win of windows) {
    const windowStart = zonedTimeToUtc(today, win.start, tz);
    const windowEnd = zonedTimeToUtc(today, win.end, tz);

    // If window already ended, skip it
    if (windowEnd.getTime() <= now.getTime()) {
      continue;
    }

    // Find accounts participating in auto routine that do not yet have a slot in this window
    const eligibleRes = await p.query<AccountRow>(
      `SELECT a.id, a.external_account_id, a.social_provider
       FROM accounts a
       WHERE a.enabled = true
         AND a.auto_post_enabled = true
         AND NOT EXISTS (
           SELECT 1 FROM auto_post_slots s
           WHERE s.slot_date = $1::date
             AND s.window_id = $2
             AND s.account_id = a.id
         )
       ORDER BY a.created_at ASC, a.id ASC`,
      [today, win.id]
    );

    const accountsToSchedule = eligibleRes.rows;
    if (accountsToSchedule.length === 0) {
      continue;
    }

    let availableStartMs = Math.max(
      windowStart.getTime(),
      now.getTime() + 5 * 60 * 1000
    );
    // Align availableStart up to the next minute boundary if it has seconds/millis
    if (availableStartMs % 60000 !== 0) {
      availableStartMs = Math.ceil(availableStartMs / 60000) * 60000;
    }

    const availableEndMs = windowEnd.getTime();

    // Check if remaining window time is less than 5 minutes
    if (availableEndMs - availableStartMs < 5 * 60 * 1000) {
      const skippedSlots: InsertSlotInput[] = accountsToSchedule.map(
        (account) => ({
          slot_date: today,
          window_id: win.id,
          account_id: account.id,
          channel: resolvePlannedChannel(account),
          scheduled_at: new Date(availableStartMs),
          window_end: windowEnd,
          status: "skipped",
          last_error: "janela sem tempo hábil",
          finished_at: now,
        })
      );
      const inserted = await insertSlots(skippedSlots, p);
      createdTotal += inserted;
      continue;
    }

    // Step 3: Fisher-Yates shuffle
    const shuffledAccounts = [...accountsToSchedule];
    for (let i = shuffledAccounts.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      const temp = shuffledAccounts[i];
      shuffledAccounts[i] = shuffledAccounts[j];
      shuffledAccounts[j] = temp;
    }

    // Step 4 & 5: Equal slices distribution
    const N = shuffledAccounts.length;
    const totalDurationMs = availableEndMs - availableStartMs;
    const segmentMs = totalDurationMs / N;
    const maxAllowedMs = availableEndMs - 60 * 1000; // limited to availableEnd - 1min

    const slotsToInsert: InsertSlotInput[] = [];

    for (let i = 0; i < N; i++) {
      const account = shuffledAccounts[i];
      const sliceStartMs = availableStartMs + i * segmentMs;
      const maxOffset = Math.floor(segmentMs);
      const offsetMs = maxOffset > 0 ? rand(maxOffset) : 0;

      let scheduledMs = sliceStartMs + offsetMs;
      if (scheduledMs > maxAllowedMs) {
        scheduledMs = maxAllowedMs;
      }

      // Round down to the minute
      const scheduledMinuteMs = Math.floor(scheduledMs / 60000) * 60000;
      const scheduledAt = new Date(scheduledMinuteMs);

      slotsToInsert.push({
        slot_date: today,
        window_id: win.id,
        account_id: account.id,
        channel: resolvePlannedChannel(account),
        scheduled_at: scheduledAt,
        window_end: windowEnd,
        status: "pending",
      });
    }

    // Step 6: Insert with ON CONFLICT DO NOTHING
    const inserted = await insertSlots(slotsToInsert, p);
    createdTotal += inserted;
  }

  return {
    created: createdTotal,
    skippedExpired,
  };
}
