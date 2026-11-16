import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { getAllSettings } from "../settings/store.js";
import { resolveAutomationTimezone } from "./windows.js";
import { localDateString } from "./time.js";

export type SlotStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "done"
  | "failed"
  | "skipped";

export type SlotChannel = "zernio" | "telegram" | "social";

export interface AutoPostSlot {
  id: string;
  slot_date: string;
  window_id: string;
  account_id: string;
  channel: SlotChannel;
  scheduled_at: Date;
  window_end: Date;
  status: SlotStatus;
  attempts: number;
  run_id: string | null;
  last_error: string | null;
  started_at: Date | null;
  approved_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertSlotInput {
  id?: string;
  slot_date: string;
  window_id: string;
  account_id: string;
  channel: SlotChannel;
  scheduled_at: Date;
  window_end: Date;
  status?: SlotStatus;
  last_error?: string | null;
  finished_at?: Date | null;
}

export interface UpdateSlotInput {
  channel?: SlotChannel;
  status?: SlotStatus;
  scheduled_at?: Date;
  window_end?: Date;
  attempts?: number;
  run_id?: string | null;
  last_error?: string | null;
  started_at?: Date | null;
  approved_at?: Date | null;
  finished_at?: Date | null;
}

function mapSlotRow(row: any): AutoPostSlot {
  let slotDate: string;
  if (typeof row.slot_date === "string") {
    slotDate = row.slot_date.substring(0, 10);
  } else if (row.slot_date instanceof Date) {
    slotDate = row.slot_date.toISOString().substring(0, 10);
  } else {
    slotDate = String(row.slot_date);
  }

  return {
    id: row.id,
    slot_date: slotDate,
    window_id: row.window_id,
    account_id: row.account_id,
    channel: row.channel,
    scheduled_at: new Date(row.scheduled_at),
    window_end: new Date(row.window_end),
    status: row.status,
    attempts: row.attempts,
    run_id: row.run_id ?? null,
    last_error: row.last_error ?? null,
    started_at: row.started_at ? new Date(row.started_at) : null,
    approved_at: row.approved_at ? new Date(row.approved_at) : null,
    finished_at: row.finished_at ? new Date(row.finished_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Inserts a batch of slots using ON CONFLICT (slot_date, window_id, account_id) DO NOTHING.
 * Returns the number of successfully created rows.
 */
export async function insertSlots(
  slots: InsertSlotInput[],
  poolInstance?: Pool
): Promise<number> {
  if (slots.length === 0) return 0;
  const p = poolInstance || getPool();

  let insertedCount = 0;
  for (const s of slots) {
    const res = await p.query(
      `INSERT INTO auto_post_slots (
        slot_date, window_id, account_id, channel, scheduled_at, window_end,
        status, last_error, finished_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (slot_date, window_id, account_id) DO NOTHING
      RETURNING id`,
      [
        s.slot_date,
        s.window_id,
        s.account_id,
        s.channel,
        s.scheduled_at,
        s.window_end,
        s.status || "pending",
        s.last_error ?? null,
        s.finished_at ?? null,
      ]
    );
    if ((res.rowCount ?? 0) > 0) {
      insertedCount++;
    }
  }

  return insertedCount;
}

/**
 * Expires pending slots that have passed window_end or have slot_date prior to today.
 * Sets status='skipped', last_error='janela encerrada', finished_at=now, updated_at=now.
 */
export async function expireOverduePendingSlots(
  options: { now: Date; today: string },
  poolInstance?: Pool
): Promise<number> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `UPDATE auto_post_slots
     SET status = 'skipped',
         last_error = 'janela encerrada',
         finished_at = $1,
         updated_at = $1
     WHERE status = 'pending'
       AND (window_end < $1 OR slot_date < $2::date)`,
    [options.now, options.today]
  );
  return res.rowCount ?? 0;
}

/**
 * Lists all slots for a given date sorted by scheduled_at ascending.
 */
export async function listSlotsByDate(
  slotDate: string,
  poolInstance?: Pool
): Promise<AutoPostSlot[]> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `SELECT * FROM auto_post_slots
     WHERE slot_date = $1::date
     ORDER BY scheduled_at ASC, id ASC`,
    [slotDate]
  );
  return res.rows.map(mapSlotRow);
}

/**
 * Gets a slot by its primary key ID.
 */
export async function getSlotById(
  id: string,
  poolInstance?: Pool
): Promise<AutoPostSlot | null> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `SELECT * FROM auto_post_slots WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!res.rows[0]) return null;
  return mapSlotRow(res.rows[0]);
}

/**
 * Updates a slot by ID.
 */
export async function updateSlot(
  id: string,
  updates: UpdateSlotInput,
  poolInstance?: Pool
): Promise<AutoPostSlot | null> {
  const p = poolInstance || getPool();
  const setClauses: string[] = ["updated_at = NOW()"];
  const values: any[] = [id];
  let idx = 2;

  if (updates.channel !== undefined) {
    setClauses.push(`channel = $${idx++}`);
    values.push(updates.channel);
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.scheduled_at !== undefined) {
    setClauses.push(`scheduled_at = $${idx++}`);
    values.push(updates.scheduled_at);
  }
  if (updates.window_end !== undefined) {
    setClauses.push(`window_end = $${idx++}`);
    values.push(updates.window_end);
  }
  if (updates.attempts !== undefined) {
    setClauses.push(`attempts = $${idx++}`);
    values.push(updates.attempts);
  }
  if (updates.run_id !== undefined) {
    setClauses.push(`run_id = $${idx++}`);
    values.push(updates.run_id);
  }
  if (updates.last_error !== undefined) {
    setClauses.push(`last_error = $${idx++}`);
    values.push(updates.last_error);
  }
  if (updates.started_at !== undefined) {
    setClauses.push(`started_at = $${idx++}`);
    values.push(updates.started_at);
  }
  if (updates.approved_at !== undefined) {
    setClauses.push(`approved_at = $${idx++}`);
    values.push(updates.approved_at);
  }
  if (updates.finished_at !== undefined) {
    setClauses.push(`finished_at = $${idx++}`);
    values.push(updates.finished_at);
  }

  const query = `
    UPDATE auto_post_slots
    SET ${setClauses.join(", ")}
    WHERE id = $1
    RETURNING *
  `;
  const res = await p.query(query, values);
  if (!res.rows[0]) return null;
  return mapSlotRow(res.rows[0]);
}

/**
 * Atomically claims the next pending slot for execution using FOR UPDATE SKIP LOCKED.
 */
export async function claimNextSlot(
  options: { now: Date; slotDate: string },
  poolInstance?: Pool
): Promise<AutoPostSlot | null> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `UPDATE auto_post_slots
     SET status = 'running', started_at = $1, attempts = attempts + 1, updated_at = $1
     WHERE id = (
       SELECT id FROM auto_post_slots
       WHERE status = 'pending' AND scheduled_at <= $1 AND slot_date = $2::date
       ORDER BY scheduled_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
    [options.now, options.slotDate]
  );
  if (!res.rows[0]) return null;
  return mapSlotRow(res.rows[0]);
}

export async function expireAwaitingApprovalSlots(
  options: { now: Date },
  poolInstance?: Pool
): Promise<number> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `UPDATE auto_post_slots
     SET status = 'skipped',
         last_error = 'aprovação expirada',
         finished_at = $1,
         updated_at = $1
     WHERE status = 'awaiting_approval'
       AND window_end < $1`,
    [options.now]
  );
  return res.rowCount ?? 0;
}

/**
 * Recovers stuck running slots.
 * - If isBoot: marks all running slots as failed ('processo reiniciou durante a execução').
 * - Otherwise: marks running slots older than timeoutMinutes as failed ('execução travada').
 */
export async function failStaleRunningSlots(
  options: { timeoutMinutes?: number; isBoot?: boolean; now?: Date },
  poolInstance?: Pool
): Promise<number> {
  const p = poolInstance || getPool();
  const now = options.now || new Date();
  if (options.isBoot) {
    const res = await p.query(
      `UPDATE auto_post_slots
       SET status = 'failed',
           last_error = 'processo reiniciou durante a execução',
           finished_at = $1,
           updated_at = $1
       WHERE status = 'running'`,
      [now]
    );
    return res.rowCount ?? 0;
  }

  const timeoutMinutes = options.timeoutMinutes ?? 15;
  const cutoff = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
  const res = await p.query(
    `UPDATE auto_post_slots
     SET status = 'failed',
         last_error = 'execução travada',
         finished_at = $1,
         updated_at = $1
     WHERE status = 'running'
       AND started_at < $2`,
    [now, cutoff]
  );
  return res.rowCount ?? 0;
}

/**
 * Gets a slot linked to a carousel run either by slot.run_id or carousel_runs.auto_post_slot_id.
 */
export async function getSlotByRunId(
  runId: string,
  poolInstance?: Pool
): Promise<AutoPostSlot | null> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `SELECT * FROM auto_post_slots
     WHERE run_id = $1
        OR id = (SELECT auto_post_slot_id FROM carousel_runs WHERE id = $1)
     LIMIT 1`,
    [runId]
  );
  if (!res.rows[0]) return null;
  return mapSlotRow(res.rows[0]);
}

/**
 * Handles retry for a slot:
 * - If attempts < 2 and now + 5min < window_end: sets pending, scheduled_at = now + 5min.
 * - Otherwise: sets failed, finished_at = now.
 */
export async function handleSlotRetry(
  slot: AutoPostSlot,
  errorMessage: string,
  now: Date,
  poolInstance?: Pool
): Promise<void> {
  const p = poolInstance || getPool();
  const retryTime = new Date(now.getTime() + 5 * 60 * 1000);
  if (slot.attempts < 2 && retryTime.getTime() < slot.window_end.getTime()) {
    await updateSlot(
      slot.id,
      {
        status: "pending",
        scheduled_at: retryTime,
        last_error: errorMessage,
      },
      p
    );
  } else {
    await updateSlot(
      slot.id,
      {
        status: "failed",
        last_error: errorMessage,
        finished_at: now,
      },
      p
    );
  }
}

export interface AutomationScheduleSlot {
  id: string;
  window_id: string;
  account_id: string;
  account_display_name: string;
  account_enabled: boolean;
  channel: SlotChannel;
  scheduled_at: string;
  window_end: string;
  status: SlotStatus;
  attempts: number;
  run_id: string | null;
  run_status: string | null;
  post_status: string | null;
  last_error: string | null;
}

export interface AutomationScheduleResponse {
  date: string;
  timezone: string;
  enabled: boolean;
  slots: AutomationScheduleSlot[];
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parts = s.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export async function getAutomationSchedule(
  options: { date?: string; pool?: Pool } = {}
): Promise<AutomationScheduleResponse> {
  const p = options.pool || getPool();
  const allSettings = await getAllSettings(p);

  const tz = resolveAutomationTimezone(allSettings);

  const autoDispatchVal = allSettings.auto_dispatch_enabled;
  let enabled = false;
  if (typeof autoDispatchVal === "boolean") {
    enabled = autoDispatchVal;
  } else if (typeof autoDispatchVal === "string") {
    enabled = autoDispatchVal.toLowerCase() === "true";
  } else if (
    typeof autoDispatchVal === "object" &&
    autoDispatchVal !== null &&
    "enabled" in autoDispatchVal
  ) {
    enabled = Boolean(autoDispatchVal.enabled);
  } else if (autoDispatchVal) {
    enabled = Boolean(autoDispatchVal);
  }

  const dateStr = options.date || localDateString(new Date(), tz);

  const res = await p.query(
    `SELECT
       s.id,
       s.window_id,
       s.account_id,
       COALESCE(NULLIF(a.display_name, ''), a.id, s.account_id) AS account_display_name,
       COALESCE(a.enabled, true) AS account_enabled,
       s.channel,
       s.scheduled_at,
       s.window_end,
       s.status,
       s.attempts,
       s.run_id,
       r.status AS run_status,
       tp.publish_status AS post_status,
       s.last_error
     FROM auto_post_slots s
     LEFT JOIN accounts a ON a.id = s.account_id
     LEFT JOIN carousel_runs r ON r.id = s.run_id
     LEFT JOIN tiktok_posts tp ON tp.run_id = s.run_id
     WHERE s.slot_date = $1::date
     ORDER BY s.scheduled_at ASC, s.id ASC`,
    [dateStr]
  );

  const slots: AutomationScheduleSlot[] = res.rows.map((row) => ({
    id: row.id,
    window_id: row.window_id,
    account_id: row.account_id,
    account_display_name: row.account_display_name,
    account_enabled: Boolean(row.account_enabled),
    channel: row.channel,
    scheduled_at: new Date(row.scheduled_at).toISOString(),
    window_end: new Date(row.window_end).toISOString(),
    status: row.status,
    attempts: Number(row.attempts),
    run_id: row.run_id ?? null,
    run_status: row.run_status ?? null,
    post_status: row.post_status ?? null,
    last_error: row.last_error ?? null,
  }));

  return {
    date: dateStr,
    timezone: tz,
    enabled,
    slots,
  };
}

