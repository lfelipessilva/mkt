import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { getSocialPublisherProvider } from "./factory.js";
import { resolveCarouselSlidePublicUrls } from "./urls.js";
import { getCarouselRun } from "../runs/store.js";
import type { SocialPublisherProvider } from "./types.js";

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
  providerInstance?: SocialPublisherProvider
): Promise<PollPendingPostsResult> {
  const p = poolInstance || getPool();
  const provider = providerInstance || getSocialPublisherProvider();

  let checkedCount = 0;
  let updatedCount = 0;
  let internalPendingReleased = 0;
  const errors: Array<{ runId: string; error: string }> = [];

  // 1. Process 'queued' and 'processing' posts
  try {
    const pendingPostsRes = await p.query(
      `SELECT tp.id, tp.run_id, tp.external_post_id, tp.publish_status, cr.legenda
       FROM tiktok_posts tp
       JOIN carousel_runs cr ON cr.id = tp.run_id
       WHERE tp.publish_status IN ('queued', 'processing')
         AND tp.external_post_id IS NOT NULL
         AND tp.created_at >= NOW() - INTERVAL '24 hours'`
    );

    for (const row of pendingPostsRes.rows) {
      checkedCount++;
      try {
        const statusRes = await provider.getPostStatus(row.external_post_id);

        if (statusRes.status !== row.publish_status) {
          if (statusRes.status === "published") {
            const publishedAt = statusRes.publishedAt ? new Date(statusRes.publishedAt) : new Date();
            await p.query(
              `UPDATE tiktok_posts
               SET publish_status = 'published',
                   published_at = COALESCE(published_at, $1),
                   last_polled_at = NOW(),
                   raw_response = $2,
                   updated_at = NOW()
               WHERE id = $3`,
              [publishedAt, JSON.stringify(statusRes.rawResponse || {}), row.id]
            );

            await p.query(
              `UPDATE carousel_runs
               SET status = 'published', updated_at = NOW()
               WHERE id = $1`,
              [row.run_id]
            );
            updatedCount++;
          } else if (statusRes.status === "failed") {
            await p.query(
              `UPDATE tiktok_posts
               SET publish_status = 'failed',
                   last_polled_at = NOW(),
                   raw_response = $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [JSON.stringify(statusRes.rawResponse || {}), row.id]
            );

            await p.query(
              `UPDATE carousel_runs
               SET status = 'failed',
                   error_message = $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [statusRes.errorMessage || "Publish failed according to provider status", row.run_id]
            );
            updatedCount++;
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
              acc.external_account_id
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

        const imageUrls = resolveCarouselSlidePublicUrls(fullRun);

        const publishRes = await provider.publishPost({
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
