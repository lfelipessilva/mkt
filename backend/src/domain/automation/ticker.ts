import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { getJobStatus, withJobLock } from "../../jobLock.js";
import { getAllSettings, getSetting } from "../settings/store.js";
import { getAccount } from "../accounts/store.js";
import { getCarouselRun } from "../runs/store.js";
import type { CarouselRun } from "../runs/schemas.js";
import { generateOneCarousel } from "../runs/generate.js";
import {
  dispatchCarouselRun,
  getDispatchEvents,
} from "../dispatch/service.js";
import type { DispatchResult } from "../dispatch/schemas.js";
import { ensureDailyPlan, resolvePlannedChannel } from "./planner.js";
import { localDateString } from "./time.js";
import { resolveAutomationTimezone } from "./windows.js";
import {
  claimNextSlot,
  expireAwaitingApprovalSlots,
  failStaleRunningSlots,
  updateSlot,
  type AutoPostSlot,
  type SlotChannel,
} from "./slots.js";
import {
  notifyAutomation,
  type AutomationNotifyEvent,
  type NotifyAutomationOptions,
  type NotifyPayload,
  type TelegramApiLike,
} from "./notifications.js";

export type GenerateCarouselFn = (options: {
  accountId: string;
  pool: Pool;
  now?: Date;
}) => Promise<CarouselRun>;

export type DispatchCarouselFn = (options: {
  runId: string;
  channel: SlotChannel;
  triggeredBy?: string;
  pool?: Pool;
}) => Promise<DispatchResult>;

export type NotifyAutomationFn = (
  event: AutomationNotifyEvent,
  payload: NotifyPayload,
  options?: NotifyAutomationOptions
) => Promise<void>;

export interface RunAutomationTickOptions {
  pool?: Pool;
  now?: Date;
  generateFn?: GenerateCarouselFn;
  dispatchFn?: DispatchCarouselFn;
  notifyFn?: NotifyAutomationFn;
  recoverStaleRunning?: boolean;
  telegramApi?: TelegramApiLike;
  appBaseUrl?: string;
  chatId?: string | null;
}

export interface RunAutomationTickResult {
  ran: boolean;
  reason?: string;
}

let tickerBusy = false;

export function isTickerBusy(): boolean {
  return tickerBusy;
}

export function resetTickerBusy(): void {
  tickerBusy = false;
}

async function handleRetry(
  slot: AutoPostSlot,
  errorMessage: string,
  now: Date,
  pool: Pool
): Promise<void> {
  const retryTime = new Date(now.getTime() + 5 * 60 * 1000);
  if (slot.attempts < 2 && retryTime.getTime() < slot.window_end.getTime()) {
    await updateSlot(
      slot.id,
      {
        status: "pending",
        scheduled_at: retryTime,
        last_error: errorMessage,
      },
      pool
    );
  } else {
    await updateSlot(
      slot.id,
      {
        status: "failed",
        last_error: errorMessage,
        finished_at: now,
      },
      pool
    );
  }
}

/**
 * Executes a single claimed slot according to spec §5.4.
 */
export async function executeSlot(
  slot: AutoPostSlot,
  options: RunAutomationTickOptions & { pool: Pool; now: Date }
): Promise<void> {
  const pool = options.pool;
  const now = options.now;

  const notifyFn: NotifyAutomationFn =
    options.notifyFn ||
    (async (event, payload, opts) => notifyAutomation(event, payload, opts));

  const notifyOpts: NotifyAutomationOptions = {
    telegramApi: options.telegramApi,
    appBaseUrl: options.appBaseUrl,
    chatId: options.chatId,
  };

  // 1. Load account; if not exists, disabled, or auto_post_enabled=false -> skipped
  const account = await getAccount(slot.account_id, pool);
  if (!account || account.enabled === false || account.auto_post_enabled === false) {
    await updateSlot(
      slot.id,
      {
        status: "skipped",
        last_error: "conta desativada",
        finished_at: now,
      },
      pool
    );
    return;
  }

  // 2. Resolve channel
  const channel = resolvePlannedChannel(account);
  if (channel === "social") {
    await updateSlot(
      slot.id,
      {
        channel: "social",
        status: "skipped",
        last_error: "provider não suportado nesta fase",
        finished_at: now,
      },
      pool
    );
    return;
  }

  if (slot.channel !== channel) {
    await updateSlot(slot.id, { channel }, pool);
  }

  // 3. If slot.run_id exists, inspect run
  let run: CarouselRun | null = null;
  let runReused = false;

  if (slot.run_id) {
    run = await getCarouselRun(slot.run_id, pool);
    if (run) {
      const dispatchEvents = await getDispatchEvents(slot.run_id, pool);
      const sentInChannel = dispatchEvents.some(
        (e) => e.channel === channel && e.status === "sent"
      );

      if (sentInChannel) {
        await updateSlot(
          slot.id,
          {
            channel,
            status: "done",
            finished_at: now,
          },
          pool
        );
        return;
      }

      if (run.status === "published") {
        await updateSlot(
          slot.id,
          {
            channel,
            status: "skipped",
            last_error: "carrossel já publicado",
            finished_at: now,
          },
          pool
        );
        return;
      }

      if (run.slides && run.slides.length > 0) {
        runReused = true;
      } else {
        run = null;
      }
    }
  }

  // 4. If no reusable run, generate one
  if (!runReused || !run) {
    const generateFn: GenerateCarouselFn =
      options.generateFn ||
      (async (opts) =>
        generateOneCarousel({
          accountId: opts.accountId,
          pool: opts.pool,
          now: opts.now ? opts.now.getTime() : undefined,
        }));

    try {
      run = await generateFn({ accountId: slot.account_id, pool, now });
      await pool.query(
        `UPDATE carousel_runs SET auto_post_slot_id = $1 WHERE id = $2`,
        [slot.id, run.id]
      );
      await updateSlot(slot.id, { channel, run_id: run.id }, pool);
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      await notifyFn(
        "generation_failed",
        { account: account.id, reason: errorMsg },
        notifyOpts
      ).catch(() => {});
      await handleRetry(slot, errorMsg, now, pool);
      return;
    }

    // 5. Generation notification (only when freshly generated)
    await notifyFn(
      "generation_ok",
      {
        account: account.id,
        archetype: run.archetype_title,
        runId: run.id,
      },
      notifyOpts
    ).catch(() => {});
  }

  // 6. Branch by channel
  if (channel === "telegram") {
    const dispatchFn: DispatchCarouselFn =
      options.dispatchFn ||
      (async (opts) =>
        dispatchCarouselRun({
          runId: opts.runId,
          channel: opts.channel,
          triggeredBy: opts.triggeredBy || "auto_schedule",
          pool: opts.pool,
        }));

    try {
      const result = await dispatchFn({
        runId: run.id,
        channel: "telegram",
        triggeredBy: "auto_schedule",
        pool,
      });

      if (result?.event?.status === "failed") {
        const reason =
          result.event.response_payload?.error ||
          result.event.response_payload?.message ||
          "falha no dispatch telegram";
        throw new Error(reason);
      }

      await updateSlot(
        slot.id,
        {
          channel: "telegram",
          status: "done",
          finished_at: now,
        },
        pool
      );

      await notifyFn(
        "telegram_sent",
        {
          account: account.id,
          archetype: run.archetype_title,
          runId: run.id,
        },
        notifyOpts
      ).catch(() => {});
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      await notifyFn(
        "publish_failed",
        {
          account: account.id,
          reason: errorMsg,
          runId: run.id,
        },
        notifyOpts
      ).catch(() => {});
      await handleRetry(slot, errorMsg, now, pool);
    }
    return;
  }

  if (channel === "zernio") {
    await updateSlot(
      slot.id,
      {
        channel: "zernio",
        status: "awaiting_approval",
      },
      pool
    );

    await notifyFn(
      "awaiting_approval",
      {
        account: account.id,
        archetype: run.archetype_title,
        runId: run.id,
      },
      notifyOpts
    ).catch(() => {});
    return;
  }
}

/**
 * Minute ticker routine for auto-post schedule (spec §5.4).
 */
export async function runAutomationTick(
  options: RunAutomationTickOptions = {}
): Promise<RunAutomationTickResult> {
  const pool = options.pool || getPool();
  const now = options.now || new Date();

  // 1. If auto_dispatch_enabled is false -> ensureDailyPlan and return { ran: false }
  const autoDispatchSetting = await getSetting<boolean>(
    "auto_dispatch_enabled",
    pool
  );
  if (autoDispatchSetting !== true) {
    await expireAwaitingApprovalSlots({ now }, pool);
    await ensureDailyPlan({ pool, now });
    return { ran: false };
  }

  // 2. If tickerBusy or getJobStatus().busy -> run expiry & daily plan maintenance, then return { ran: false, reason: "busy" }
  if (tickerBusy || getJobStatus().busy) {
    await expireAwaitingApprovalSlots({ now }, pool);
    await ensureDailyPlan({ pool, now });
    return { ran: false, reason: "busy" };
  }

  tickerBusy = true;
  try {
    // 3. Stale running recovery
    await failStaleRunningSlots(
      {
        timeoutMinutes: 15,
        isBoot: options.recoverStaleRunning,
        now,
      },
      pool
    );
    await expireAwaitingApprovalSlots({ now }, pool);

    // 4. withJobLock
    return await withJobLock(async () => {
      await ensureDailyPlan({ pool, now });

      const allSettings = await getAllSettings(pool);
      const tz = resolveAutomationTimezone(allSettings);
      const slotDate = localDateString(now, tz);

      const slot = await claimNextSlot({ now, slotDate }, pool);
      if (!slot) {
        return { ran: false };
      }

      try {
        await executeSlot(slot, { ...options, pool, now });
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        await handleRetry(slot, errorMsg, now, pool).catch(() => {});
      }
      return { ran: true };
    });
  } finally {
    tickerBusy = false;
  }
}
