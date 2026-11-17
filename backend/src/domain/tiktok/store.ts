import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import type {
  TikTokPost,
  TikTokPerformanceItem,
  UpsertTikTokPostInput,
  TikTokPerformanceQuery,
  TikTokPerformanceInputQuery,
  TikTokSyncResult,
} from "./schemas.js";
import type { CarouselRun } from "../runs/schemas.js";
import { syncTikTokMetricsDailyJob } from "../social/metricsSync.js";

export function mapTikTokPostRow(row: any): TikTokPost {
  return {
    id: row.id,
    run_id: row.run_id,
    tracking_mode: row.tracking_mode,
    video_id: row.video_id ?? null,
    video_url: row.video_url ?? null,
    published_at: row.published_at ? new Date(row.published_at) : null,
    views: Number(row.views || 0),
    likes: Number(row.likes || 0),
    comments: Number(row.comments || 0),
    shares: Number(row.shares || 0),
    metrics_note: row.metrics_note ?? null,
    provider: row.provider ?? "manual",
    external_post_id: row.external_post_id ?? null,
    publish_status: row.publish_status ?? "published",
    scheduled_at: row.scheduled_at ? new Date(row.scheduled_at) : null,
    last_polled_at: row.last_polled_at ? new Date(row.last_polled_at) : null,
    raw_response: row.raw_response ?? null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

function mapPerformanceRow(row: any): TikTokPerformanceItem {
  const post: TikTokPost = {
    id: row.tiktok_post_id,
    run_id: row.run_id,
    tracking_mode: row.tracking_mode,
    video_id: row.video_id ?? null,
    video_url: row.video_url ?? null,
    published_at: row.published_at ? new Date(row.published_at) : null,
    views: Number(row.views || 0),
    likes: Number(row.likes || 0),
    comments: Number(row.comments || 0),
    shares: Number(row.shares || 0),
    metrics_note: row.metrics_note ?? null,
    provider: row.provider ?? "manual",
    external_post_id: row.external_post_id ?? null,
    publish_status: row.publish_status ?? "published",
    scheduled_at: row.scheduled_at ? new Date(row.scheduled_at) : null,
    last_polled_at: row.last_polled_at ? new Date(row.last_polled_at) : null,
    created_at: new Date(row.post_created_at),
    updated_at: new Date(row.post_updated_at),
  };

  const run: CarouselRun = {
    id: row.run_id,
    job_id: row.job_id ?? null,
    account_id: row.account_id,
    account_role: row.account_role,
    archetype_title: row.archetype_title,
    bait_body: row.bait_body ?? null,
    tema: row.tema ?? null,
    legenda: row.legenda,
    status: row.status,
    output_dir: row.output_dir ?? null,
    error_message: row.error_message ?? null,
    generated_at: row.generated_at ? new Date(row.generated_at) : null,
    created_at: new Date(row.run_created_at),
    updated_at: new Date(row.run_updated_at),
    tiktok_post: {
      provider: row.provider ?? "manual",
      external_post_id: row.external_post_id ?? null,
      publish_status: row.publish_status ?? "published",
      published_at: post.published_at,
      last_polled_at: post.last_polled_at ?? null,
      video_url: row.video_url ?? null,
    },
  };

  return {
    id: row.tiktok_post_id,
    tiktok_post_id: row.tiktok_post_id,
    run_id: row.run_id,
    account_id: row.account_id,
    account_role: row.account_role,
    account_display_name: row.account_display_name ?? null,
    archetype_title: row.archetype_title,
    bait_body: row.bait_body ?? null,
    tema: row.tema ?? null,
    legenda: row.legenda,
    status: row.status,
    output_dir: row.output_dir ?? null,
    tracking_mode: row.tracking_mode,
    video_id: row.video_id ?? null,
    video_url: row.video_url ?? null,
    provider: row.provider ?? "manual",
    external_post_id: row.external_post_id ?? null,
    publish_status: row.publish_status ?? "published",
    scheduled_at: row.scheduled_at ? new Date(row.scheduled_at) : null,
    last_polled_at: row.last_polled_at ? new Date(row.last_polled_at) : null,
    published_at: post.published_at,
    views: post.views,
    likes: post.likes,
    comments: post.comments,
    shares: post.shares,
    metrics_note: post.metrics_note,
    generated_at: run.generated_at ?? null,
    created_at: post.created_at,
    updated_at: post.updated_at,
    run,
    post,
  };
}

export async function upsertTikTokPost(
  runId: string,
  input: UpsertTikTokPostInput,
  poolInstance?: Pool
): Promise<{ post: TikTokPost; run: CarouselRun }> {
  const p = poolInstance || getPool();

  // 1. Verify run exists
  const runRes = await p.query(
    "SELECT id, status FROM carousel_runs WHERE id = $1",
    [runId]
  );
  if (runRes.rows.length === 0) {
    throw new AppError(`Run '${runId}' not found`, 404, "not_found");
  }

  // 2. Check if post already exists to know if this is insert or update
  const existingPostRes = await p.query(
    `SELECT id, published_at, tracking_mode, provider, external_post_id,
            views, likes, comments, shares
     FROM tiktok_posts WHERE run_id = $1`,
    [runId]
  );
  const existingPost = existingPostRes.rows[0];

  let publishedAt: Date | null;
  if (input.published_at !== undefined) {
    publishedAt = input.published_at ? new Date(input.published_at) : null;
  } else if (existingPost) {
    publishedAt = existingPost.published_at ? new Date(existingPost.published_at) : new Date();
  } else {
    publishedAt = new Date();
  }

  // A post published through Zernio keeps API tracking even when the operator
  // edits its metrics by hand. Manual runs still default to 'manual'.
  const zernioTracked = Boolean(
    existingPost &&
      (existingPost.provider === "zernio" || existingPost.external_post_id)
  );
  const trackingMode = zernioTracked
    ? existingPost.tracking_mode || "api"
    : input.tracking_mode || "manual";

  const existingValue = (key: "views" | "likes" | "comments" | "shares"): number =>
    existingPost ? Number(existingPost[key] || 0) : 0;

  const videoUrl = input.video_url ?? null;
  const videoId = input.video_id ?? null;
  const views = input.views ?? existingValue("views");
  const likes = input.likes ?? existingValue("likes");
  const comments = input.comments ?? existingValue("comments");
  const shares = input.shares ?? existingValue("shares");
  const metricsNote = input.metrics_note ?? null;

  const client = await p.connect();
  try {
    await client.query("BEGIN");

    const upsertQuery = `
      INSERT INTO tiktok_posts (
        run_id,
        tracking_mode,
        video_id,
        video_url,
        published_at,
        views,
        likes,
        comments,
        shares,
        metrics_note,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      ON CONFLICT (run_id) DO UPDATE SET
        tracking_mode = EXCLUDED.tracking_mode,
        video_id = COALESCE(EXCLUDED.video_id, tiktok_posts.video_id),
        video_url = COALESCE(EXCLUDED.video_url, tiktok_posts.video_url),
        published_at = EXCLUDED.published_at,
        views = EXCLUDED.views,
        likes = EXCLUDED.likes,
        comments = EXCLUDED.comments,
        shares = EXCLUDED.shares,
        metrics_note = COALESCE(EXCLUDED.metrics_note, tiktok_posts.metrics_note),
        updated_at = NOW()
      RETURNING id, run_id, tracking_mode, video_id, video_url, published_at,
                views, likes, comments, shares, metrics_note, provider,
                external_post_id, publish_status, scheduled_at, last_polled_at,
                raw_response, created_at, updated_at
    `;

    const upsertRes = await client.query(upsertQuery, [
      runId,
      trackingMode,
      videoId,
      videoUrl,
      publishedAt,
      views,
      likes,
      comments,
      shares,
      metricsNote,
    ]);

    // Mark run status = 'published'
    const updateRunQuery = `
      UPDATE carousel_runs
      SET status = 'published', updated_at = NOW()
      WHERE id = $1
      RETURNING id, job_id, account_id, account_role, archetype_title, bait_body, tema,
                legenda, status, output_dir, error_message, generated_at, created_at, updated_at
    `;
    const updatedRunRes = await client.query(updateRunQuery, [runId]);

    await client.query("COMMIT");

    const post = mapTikTokPostRow(upsertRes.rows[0]);
    const runRow = updatedRunRes.rows[0];
    const run: CarouselRun = {
      id: runRow.id,
      job_id: runRow.job_id ?? null,
      account_id: runRow.account_id,
      account_role: runRow.account_role,
      archetype_title: runRow.archetype_title,
      bait_body: runRow.bait_body ?? null,
      tema: runRow.tema ?? null,
      legenda: runRow.legenda,
      status: runRow.status,
      output_dir: runRow.output_dir ?? null,
      error_message: runRow.error_message ?? null,
      generated_at: runRow.generated_at ? new Date(runRow.generated_at) : null,
      created_at: new Date(runRow.created_at),
      updated_at: new Date(runRow.updated_at),
    };

    return { post, run };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getTikTokPostByRunId(
  runId: string,
  poolInstance?: Pool
): Promise<TikTokPost | null> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `SELECT id, run_id, tracking_mode, video_id, video_url, published_at,
            views, likes, comments, shares, metrics_note, provider,
            external_post_id, publish_status, scheduled_at, last_polled_at,
            raw_response, created_at, updated_at
     FROM tiktok_posts
     WHERE run_id = $1`,
    [runId]
  );
  if (res.rows.length === 0) {
    return null;
  }
  return mapTikTokPostRow(res.rows[0]);
}

export async function listTikTokPerformance(
  filters: TikTokPerformanceInputQuery = {},
  poolInstance?: Pool
): Promise<TikTokPerformanceItem[]> {
  const p = poolInstance || getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.accountId) {
    params.push(filters.accountId);
    conditions.push(`r.account_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sortMap: Record<string, string> = {
    views: "tp.views",
    likes: "tp.likes",
    comments: "tp.comments",
    shares: "tp.shares",
    published_at: "COALESCE(tp.published_at, tp.created_at)",
    created_at: "tp.created_at",
  };

  const sortColumn = sortMap[filters.sort || "views"] || "tp.views";
  const sortDirection = filters.order === "asc" ? "ASC" : "DESC";

  let paginationClause = "";
  if (filters.limit) {
    params.push(filters.limit);
    paginationClause += ` LIMIT $${params.length}`;
  }
  if (filters.offset) {
    params.push(filters.offset);
    paginationClause += ` OFFSET $${params.length}`;
  }

  const query = `
    SELECT
      tp.id AS tiktok_post_id,
      tp.run_id,
      tp.tracking_mode,
      tp.video_id,
      tp.video_url,
      tp.published_at,
      tp.views,
      tp.likes,
      tp.comments,
      tp.shares,
      tp.metrics_note,
      tp.provider,
      tp.external_post_id,
      tp.publish_status,
      tp.scheduled_at,
      tp.last_polled_at,
      tp.created_at AS post_created_at,
      tp.updated_at AS post_updated_at,
      r.job_id,
      r.account_id,
      r.account_role,
      r.archetype_title,
      r.bait_body,
      r.tema,
      r.legenda,
      r.status,
      r.output_dir,
      r.error_message,
      r.generated_at,
      r.created_at AS run_created_at,
      r.updated_at AS run_updated_at,
      a.display_name AS account_display_name
    FROM tiktok_posts tp
    JOIN carousel_runs r ON tp.run_id = r.id
    LEFT JOIN accounts a ON r.account_id = a.id
    ${whereClause}
    ORDER BY ${sortColumn} ${sortDirection}, tp.created_at DESC
    ${paginationClause}
  `;

  const result = await p.query(query, params);
  return result.rows.map(mapPerformanceRow);
}

export async function runTikTokSyncStub(poolInstance?: Pool): Promise<TikTokSyncResult> {
  const p = poolInstance || getPool();

  const manualCountRes = await p.query(
    "SELECT COUNT(*) AS count FROM tiktok_posts WHERE tracking_mode = 'manual'"
  );
  const skippedManual = parseInt(manualCountRes.rows[0].count, 10);

  const result = await syncTikTokMetricsDailyJob(p);
  const status = !result.ok
    ? "failed"
    : result.errors.length > 0
      ? "partial"
      : "completed";

  return {
    ok: result.ok,
    status,
    posts_updated: result.postsUpdated,
    skipped_manual: skippedManual,
    sync_run_id: result.syncRunId ?? "",
    errors: result.errors,
  };
}

export async function getLatestTikTokSyncRun(poolInstance?: Pool): Promise<any | null> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `SELECT id, started_at, finished_at, posts_updated, status, error_message
     FROM tiktok_sync_runs
     ORDER BY started_at DESC
     LIMIT 1`
  );
  if (!res.rows[0]) return null;
  return res.rows[0];
}
