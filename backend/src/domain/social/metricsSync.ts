import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { getSocialPublisherProvider } from "./factory.js";
import type { SocialPublisherProvider } from "./types.js";

export interface SyncTikTokMetricsResult {
  ok: boolean;
  postsChecked: number;
  postsUpdated: number;
  syncRunId?: string;
  errors: Array<{ postId: string; error: string }>;
}

/**
 * Daily Metrics Sync Worker:
 * 1. Queries published posts less than 30 days old with an external_post_id.
 * 2. Calls provider.getPostMetrics(externalPostId).
 * 3. Updates tiktok_posts (views, likes, comments, shares).
 * 4. Inserts row into tiktok_metrics snapshot table.
 * 5. Logs execution into tiktok_sync_runs.
 */
export async function syncTikTokMetricsDailyJob(
  poolInstance?: Pool,
  providerInstance?: SocialPublisherProvider
): Promise<SyncTikTokMetricsResult> {
  const p = poolInstance || getPool();
  const provider = providerInstance || getSocialPublisherProvider();

  const startedAt = new Date();
  let postsChecked = 0;
  let postsUpdated = 0;
  const errors: Array<{ postId: string; error: string }> = [];

  try {
    const candidatePostsRes = await p.query(
      `SELECT id, run_id, external_post_id, published_at
       FROM tiktok_posts
       WHERE provider = 'zernio'
         AND external_post_id IS NOT NULL
         AND publish_status = 'published'
         AND published_at IS NOT NULL
         AND published_at >= NOW() - INTERVAL '30 days'`
    );

    for (const post of candidatePostsRes.rows) {
      postsChecked++;
      try {
        const metrics = await provider.getPostMetrics(post.external_post_id);
        if (!metrics) {
          continue;
        }

        const client = await p.connect();
        try {
          await client.query("BEGIN");

          await client.query(
            `UPDATE tiktok_posts
             SET views = $1,
                 likes = $2,
                 comments = $3,
                 shares = $4,
                 saves = $5,
                 video_url = COALESCE(video_url, $7),
                 updated_at = NOW()
             WHERE id = $6`,
            [
              metrics.views,
              metrics.likes,
              metrics.comments,
              metrics.shares,
              metrics.saves,
              post.id,
              metrics.postUrl ?? null,
            ]
          );

          await client.query(
            `INSERT INTO tiktok_metrics (tiktok_post_id, views, likes, comments, shares, saves, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
              post.id,
              metrics.views,
              metrics.likes,
              metrics.comments,
              metrics.shares,
              metrics.saves,
            ]
          );

          await client.query("COMMIT");
          postsUpdated++;
        } catch (trxErr) {
          await client.query("ROLLBACK");
          throw trxErr;
        } finally {
          client.release();
        }
      } catch (err: any) {
        errors.push({ postId: post.id, error: err.message || String(err) });
      }
    }

    const syncRunRes = await p.query(
      `INSERT INTO tiktok_sync_runs (started_at, finished_at, posts_updated, status, error_message)
       VALUES ($1, NOW(), $2, $3, $4)
       RETURNING id`,
      [
        startedAt,
        postsUpdated,
        errors.length > 0 ? "partial" : "completed",
        errors.length > 0 ? JSON.stringify(errors) : null,
      ]
    );

    return {
      ok: true,
      postsChecked,
      postsUpdated,
      syncRunId: syncRunRes.rows[0]?.id,
      errors,
    };
  } catch (globalErr: any) {
    const errorMsg = globalErr.message || String(globalErr);
    await p.query(
      `INSERT INTO tiktok_sync_runs (started_at, finished_at, posts_updated, status, error_message)
       VALUES ($1, NOW(), 0, 'failed', $2)`,
      [startedAt, errorMsg]
    );

    return {
      ok: false,
      postsChecked,
      postsUpdated: 0,
      errors: [{ postId: "global", error: errorMsg }],
    };
  }
}
