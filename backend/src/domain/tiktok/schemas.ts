import { z } from "zod";
import type { CarouselRun } from "../runs/schemas.js";

export const TikTokTrackingModeSchema = z.enum(["manual", "api"]);
export type TikTokTrackingMode = z.infer<typeof TikTokTrackingModeSchema>;

export const UpsertTikTokPostSchema = z.object({
  video_url: z.string().optional().nullable(),
  video_id: z.string().optional().nullable(),
  published_at: z.union([z.string(), z.date()]).optional().nullable(),
  views: z.coerce.number().int().nonnegative().optional(),
  likes: z.coerce.number().int().nonnegative().optional(),
  comments: z.coerce.number().int().nonnegative().optional(),
  shares: z.coerce.number().int().nonnegative().optional(),
  metrics_note: z.string().optional().nullable(),
  tracking_mode: TikTokTrackingModeSchema.optional(),
});
export type UpsertTikTokPostInput = z.infer<typeof UpsertTikTokPostSchema>;

export const TikTokPerformanceQuerySchema = z.object({
  accountId: z.string().optional(),
  sort: z
    .enum(["views", "likes", "comments", "shares", "published_at", "created_at"])
    .optional()
    .default("views"),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type TikTokPerformanceQuery = z.infer<typeof TikTokPerformanceQuerySchema>;
export type TikTokPerformanceInputQuery = z.input<typeof TikTokPerformanceQuerySchema>;

export interface TikTokPost {
  id: string;
  run_id: string;
  tracking_mode: TikTokTrackingMode;
  video_id: string | null;
  video_url: string | null;
  published_at: Date | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  metrics_note: string | null;
  provider?: string;
  external_post_id?: string | null;
  publish_status?: string;
  scheduled_at?: Date | null;
  last_polled_at?: Date | null;
  raw_response?: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface TikTokPerformanceItem {
  id: string;
  tiktok_post_id: string;
  run_id: string;
  account_id: string;
  account_role: string;
  account_display_name: string | null;
  archetype_title: string;
  bait_body: string | null;
  tema: string | null;
  legenda: string;
  status: string;
  output_dir: string | null;
  tracking_mode: TikTokTrackingMode;
  video_id: string | null;
  video_url: string | null;
  provider?: string;
  external_post_id?: string | null;
  publish_status?: string;
  scheduled_at?: Date | null;
  last_polled_at?: Date | null;
  published_at: Date | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  metrics_note: string | null;
  generated_at: Date | null;
  created_at: Date;
  updated_at: Date;
  run: CarouselRun;
  post: TikTokPost;
}

export interface TikTokSyncResult {
  ok: boolean;
  status: string;
  posts_updated: number;
  skipped_manual: number;
  sync_run_id: string;
  errors?: Array<{ postId: string; error: string }>;
}
