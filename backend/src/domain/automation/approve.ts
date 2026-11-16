import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import { getCarouselRun } from "../runs/store.js";
import type { CarouselRun } from "../runs/schemas.js";
import { dispatchCarouselRun } from "../dispatch/service.js";
import type { DispatchResult } from "../dispatch/schemas.js";
import {
  getSlotById,
  getSlotByRunId,
  updateSlot,
  handleSlotRetry,
  type AutoPostSlot,
} from "./slots.js";
import {
  notifyAutomation,
  type AutomationNotifyEvent,
  type NotifyPayload,
  type NotifyAutomationOptions,
  type TelegramApiLike,
} from "./notifications.js";
import type { DispatchCarouselFn, NotifyAutomationFn } from "./ticker.js";

export interface ApproveBufferRunOptions {
  pool?: Pool;
  now?: Date;
  dispatchFn?: DispatchCarouselFn;
  notifyFn?: NotifyAutomationFn;
  telegramApi?: TelegramApiLike;
  appBaseUrl?: string;
  chatId?: string | null;
}

export interface ApproveBufferRunResult {
  ok: true;
  already?: boolean;
  run: CarouselRun;
}

async function waitForRunningSlot(
  slotId: string,
  initialSlot: AutoPostSlot,
  pool: Pool,
  maxWaitMs = 1500,
  intervalMs = 50
): Promise<AutoPostSlot> {
  let currentSlot = initialSlot;
  const maxAttempts = Math.ceil(maxWaitMs / intervalMs);
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const polled = await getSlotById(slotId, pool);
    if (polled) {
      currentSlot = polled;
      if (polled.status !== "running") {
        break;
      }
    }
  }
  return currentSlot;
}

/**
 * Approves and publishes a carousel run to Buffer for auto-post schedule (spec §5.4.1).
 * Idempotent: returns { ok: true, already: true, run } if slot is already done.
 */
export async function approveBufferRun(
  runId: string,
  options: ApproveBufferRunOptions = {}
): Promise<ApproveBufferRunResult> {
  const pool = options.pool || getPool();
  const now = options.now || new Date();

  const notifyFn: NotifyAutomationFn =
    options.notifyFn ||
    (async (event, payload, opts) => notifyAutomation(event, payload, opts));

  const notifyOpts: NotifyAutomationOptions = {
    telegramApi: options.telegramApi,
    appBaseUrl: options.appBaseUrl,
    chatId: options.chatId,
  };

  // 1. Load run
  const run = await getCarouselRun(runId, pool);
  if (!run) {
    throw new AppError(`CarouselRun not found: ${runId}`, 404, "not_found");
  }

  // 2. Load linked slot
  const slot = await getSlotByRunId(runId, pool);
  if (!slot) {
    throw new AppError(`Slot not found for carousel run: ${runId}`, 404, "not_found");
  }

  // 3. Check if already done (idempotent)
  if (slot.status === "done") {
    const freshRun = await getCarouselRun(runId, pool);
    return {
      ok: true,
      already: true,
      run: (freshRun || run) as CarouselRun,
    };
  }

  // 4. Check expired approval
  if (slot.status === "skipped" && slot.last_error === "aprovação expirada") {
    throw new AppError("aprovação expirada", 410, "approval_expired");
  }

  if (slot.status === "awaiting_approval" && slot.window_end.getTime() < now.getTime()) {
    await updateSlot(
      slot.id,
      {
        status: "skipped",
        last_error: "aprovação expirada",
        finished_at: now,
      },
      pool
    );
    throw new AppError("aprovação expirada", 410, "approval_expired");
  }

  // 5. If slot is already running (concurrent approval in progress), wait for it to settle
  if (slot.status === "running") {
    const settled = await waitForRunningSlot(slot.id, slot, pool);
    if (settled.status === "done") {
      const freshRun = await getCarouselRun(runId, pool);
      return {
        ok: true,
        already: true,
        run: (freshRun || run) as CarouselRun,
      };
    }
    if (settled.status === "skipped" && settled.last_error === "aprovação expirada") {
      throw new AppError("aprovação expirada", 410, "approval_expired");
    }
    throw new AppError(
      `Slot is not awaiting approval (status: ${settled.status})`,
      409,
      "slot_not_awaiting_approval"
    );
  }

  // 6. Check if slot is not in awaiting_approval
  if (slot.status !== "awaiting_approval") {
    throw new AppError(
      `Slot is not awaiting approval (status: ${slot.status})`,
      409,
      "slot_not_awaiting_approval"
    );
  }

  // 7. Concurrency claim: atomic update (sets started_at = now so failStaleRunningSlots won't fail it mid-dispatch)
  const claimRes = await pool.query(
    `UPDATE auto_post_slots
     SET status = 'running',
         started_at = $1,
         approved_at = $1,
         updated_at = $1
     WHERE id = $2 AND status = 'awaiting_approval'
     RETURNING *`,
    [now, slot.id]
  );

  if ((claimRes.rowCount ?? 0) === 0) {
    // Another caller or worker claimed it concurrently
    const currentSlot = await getSlotById(slot.id, pool);
    const settled =
      currentSlot?.status === "running"
        ? await waitForRunningSlot(slot.id, currentSlot, pool)
        : currentSlot;

    if (settled?.status === "done") {
      const freshRun = await getCarouselRun(runId, pool);
      return {
        ok: true,
        already: true,
        run: (freshRun || run) as CarouselRun,
      };
    }
    if (settled?.status === "skipped" && settled.last_error === "aprovação expirada") {
      throw new AppError("aprovação expirada", 410, "approval_expired");
    }
    throw new AppError(
      `Slot is not awaiting approval (status: ${settled?.status})`,
      409,
      "slot_not_awaiting_approval"
    );
  }

  // 7. Dispatch to Buffer
  const dispatchFn: DispatchCarouselFn =
    options.dispatchFn ||
    (async (opts) =>
      dispatchCarouselRun({
        runId: opts.runId,
        channel: opts.channel as any,
        triggeredBy: opts.triggeredBy || "approval",
        pool: opts.pool,
      }));

  try {
    const result = await dispatchFn({
      runId,
      channel: "zernio",
      triggeredBy: "approval",
      pool,
    });

    if (result?.event?.status === "failed") {
      const reason =
        result.event.response_payload?.error ||
        result.event.response_payload?.message ||
        "falha no dispatch buffer";
      throw new Error(reason);
    }

    await updateSlot(
      slot.id,
      {
        status: "done",
        finished_at: now,
      },
      pool
    );

    // Notify Buffer acceptance
    await notifyFn(
      "buffer_accepted",
      {
        account: slot.account_id,
        archetype: run.archetype_title,
        runId,
      },
      notifyOpts
    ).catch(() => {});

    const freshRun = await getCarouselRun(runId, pool);
    return {
      ok: true,
      run: (freshRun || result?.run || run) as CarouselRun,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    await notifyFn(
      "publish_failed",
      {
        account: slot.account_id,
        reason: errorMsg,
        runId,
      },
      notifyOpts
    ).catch(() => {});

    await handleSlotRetry(slot, errorMsg, now, pool);
    throw err;
  }
}
