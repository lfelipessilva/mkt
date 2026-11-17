import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { getSocialPublisherProvider } from "./factory.js";
import { resolveCarouselSlidePublicUrls } from "./urls.js";
import { getCarouselRun } from "../runs/store.js";
import type { SocialPublisherProvider } from "./types.js";
import {
  notifyAutomation,
  type AutomationNotifyEvent,
  type NotifyAutomationOptions,
  type NotifyPayload,
  type TelegramApiLike,
} from "../automation/notifications.js";
import type { NotifyAutomationFn } from "../automation/ticker.js";

export type { NotifyAutomationFn };

export interface PollPendingPostsOptions {
  notifyFn?: NotifyAutomationFn;
  telegramApi?: TelegramApiLike;
  chatId?: string | null;
  appBaseUrl?: string | null;
}

export interface PollPendingPostsResult {
  checkedCount: number;
  updatedCount: number;
  internalPendingReleased: number;
  errors: Array<{ runId: string; error: string }>;
}

/**
 * Polling Worker:
 * 1. Checks posts in 'queued' or 'processing' status created/updated recently and queries provider for latest status.
 *    Transitions to 'published' or 'failed' and updates both tiktok_posts and carousel_runs.
 * 2. Checks posts in 'internal_pending' status where scheduled_at <= now() and publishes them via publishPost('immediate').
 */
export async function pollPendingPostsJob(
  poolInstance?: Pool,
  providerInstance?: SocialPublisherProvider,
  options: PollPendingPostsOptions = {}
): Promise<PollPendingPostsResult> {
  const p = poolInstance || getPool();
  const provider = providerInstance || getSocialPublisherProvider();

  const notifyFn: NotifyAutomationFn =
    options.notifyFn ||
    (async (event, payload, opts) => notifyAutomation(event, payload, opts));

  const notifyOpts: NotifyAutomationOptions = {
    telegramApi: options.telegramApi,
    appBaseUrl: options.appBaseUrl,
    chatId: options.chatId,
  };

  let checkedCount = 0;
  let updatedCount = 0;
  let internalPendingReleased = 0;
  const errors: Array<{ runId: string; error: string }> = [];

  // Reconcile runs whose post was already confirmed as published, including
  // posts created before the dispatch started marking runs as published.
  try {
    await p.query(
      `UPDATE carousel_runs cr
       SET status = 'published', updated_at = NOW()
       FROM tiktok_posts tp
       WHERE tp.run_id = cr.id
         AND tp.publish_status = 'published'
         AND cr.status <> 'published'`
    );
  } catch (err: any) {
    errors.push({ runId: "published_reconcile", error: err.message || String(err) });
  }

  // 1. Process 'queued' and 'processing' posts
  try {
    const pendingPostsRes = await p.query(
      `SELECT tp.id, tp.run_id, tp.external_post_id, tp.publish_status, tp.notified_at,
              cr.legenda, cr.auto_post_slot_id, cr.account_id, cr.archetype_title,
              acc.zernio_api_key
       FROM tiktok_posts tp
       JOIN carousel_runs cr ON cr.id = tp.run_id
       LEFT JOIN accounts acc ON acc.id = cr.account_id
       WHERE tp.publish_status IN ('queued', 'processing')
         AND tp.external_post_id IS NOT NULL
         AND tp.created_at >= NOW() - INTERVAL '7 days'`
    );

    for (const row of pendingPostsRes.rows) {
      checkedCount++;
      try {
        const postProvider =
          providerInstance ||
          getSocialPublisherProvider("zernio", {
            apiKey: row.zernio_api_key?.trim() || undefined,
          });
        const statusRes = await postProvider.getPostStatus(row.external_post_id);

        if (statusRes.status !== row.publish_status) {
          if (statusRes.status === "published") {
            const publishedAt = statusRes.publishedAt ? new Date(statusRes.publishedAt) : new Date();
            const shouldNotify = Boolean(row.auto_post_slot_id && !row.notified_at);

            await p.query(
              `UPDATE tiktok_posts
               SET publish_status = 'published',
                   published_at = COALESCE(published_at, $1),
                   last_polled_at = NOW(),
                   raw_response = $2,
                   notified_at = CASE WHEN $3::boolean THEN NOW() ELSE notified_at END,
                   updated_at = NOW()
               WHERE id = $4`,
              [publishedAt, JSON.stringify(statusRes.rawResponse || {}), shouldNotify, row.id]
            );

            await p.query(
              `UPDATE carousel_runs
               SET status = 'published', updated_at = NOW()
               WHERE id = $1`,
              [row.run_id]
            );
            updatedCount++;

            if (shouldNotify) {
              await notifyFn(
                "publish_ok",
                {
                  account: row.account_id,
                  archetype: row.archetype_title || undefined,
                  runId: row.run_id,
                },
                notifyOpts
              ).catch((err) => {
                console.error("[polling:notify]", err);
              });
            }
          } else if (statusRes.status === "failed") {
            const shouldNotify = Boolean(row.auto_post_slot_id && !row.notified_at);
            const errorMessage = statusRes.errorMessage || "Publish failed according to provider status";

            await p.query(
              `UPDATE tiktok_posts
               SET publish_status = 'failed',
                   last_polled_at = NOW(),
                   raw_response = $1,
                   notified_at = CASE WHEN $2::boolean THEN NOW() ELSE notified_at END,
                   updated_at = NOW()
               WHERE id = $3`,
              [JSON.stringify(statusRes.rawResponse || {}), shouldNotify, row.id]
            );

            await p.query(
              `UPDATE carousel_runs
               SET status = 'failed',
                   error_message = $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [errorMessage, row.run_id]
            );
            updatedCount++;

            if (shouldNotify) {
              await notifyFn(
                "publish_failed",
                {
                  account: row.account_id,
                  reason: errorMessage,
                  archetype: row.archetype_title || undefined,
                  runId: row.run_id,
                },
                notifyOpts
              ).catch((err) => {
                console.error("[polling:notify]", err);
              });
            }
          } else {
            // Still queued / processing, just update last_polled_at
            await p.query(
              `UPDATE tiktok_posts
               SET last_polled_at = NOW(), updated_at = NOW()
               WHERE id = $1`,
              [row.id]
            );
          }
        } else {
          await p.query(
            `UPDATE tiktok_posts
             SET last_polled_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [row.id]
          );
        }
      } catch (err: any) {
        errors.push({ runId: row.run_id, error: err.message || String(err) });
      }
    }
  } catch (err: any) {
    errors.push({ runId: "pending_query", error: err.message || String(err) });
  }

  // 2. Process 'internal_pending' posts where scheduled_at <= now()
  try {
    const internalPendingRes = await p.query(
      `SELECT tp.id, tp.run_id, tp.scheduled_at,
              cr.id as run_id, cr.account_id, cr.account_role, cr.archetype_title,
              cr.bait_body, cr.tema, cr.legenda, cr.status as run_status,
              cr.output_dir, cr.generated_at,
              acc.external_account_id, acc.zernio_api_key
       FROM tiktok_posts tp
       JOIN carousel_runs cr ON cr.id = tp.run_id
       JOIN accounts acc ON acc.id = cr.account_id
       WHERE tp.publish_status = 'internal_pending'
         AND tp.scheduled_at IS NOT NULL
         AND tp.scheduled_at <= NOW()`
    );

    for (const row of internalPendingRes.rows) {
      try {
        const fullRun = await getCarouselRun(row.run_id, p);
        if (!fullRun) {
          throw new Error(`Carousel run not found: ${row.run_id}`);
        }

        const imageUrls = await resolveCarouselSlidePublicUrls(fullRun);

        const postProvider =
          providerInstance ||
          getSocialPublisherProvider("zernio", {
            apiKey: row.zernio_api_key?.trim() || undefined,
          });

        const publishRes = await postProvider.publishPost({
          internalPostId: row.run_id,
          externalAccountId: row.external_account_id,
          caption: fullRun.legenda || "",
          media: {
            type: "carousel",
            imageUrls,
          },
          publishMode: "immediate",
        });

        const publishedAt =
          publishRes.status === "published"
            ? (publishRes.publishedAt ? new Date(publishRes.publishedAt) : new Date())
            : null;

        await p.query(
          `UPDATE tiktok_posts
           SET external_post_id = $1,
               publish_status = $2,
               published_at = COALESCE(published_at, $3),
               last_polled_at = NOW(),
               raw_response = $4,
               updated_at = NOW()
           WHERE id = $5`,
          [
            publishRes.externalPostId,
            publishRes.status,
            publishedAt,
            JSON.stringify(publishRes.rawResponse || {}),
            row.id,
          ]
        );

        if (publishRes.status === "published") {
          await p.query(
            `UPDATE carousel_runs SET status = 'published', updated_at = NOW() WHERE id = $1`,
            [row.run_id]
          );
        } else if (publishRes.status === "failed") {
          await p.query(
            `UPDATE carousel_runs SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
            [publishRes.errorMessage || "Internal pending dispatch failed", row.run_id]
          );
        }

        internalPendingReleased++;
      } catch (err: any) {
        errors.push({ runId: row.run_id, error: err.message || String(err) });
      }
    }
  } catch (err: any) {
    errors.push({ runId: "internal_pending_query", error: err.message || String(err) });
  }

  return {
    checkedCount,
    updatedCount,
    internalPendingReleased,
    errors,
  };
}
