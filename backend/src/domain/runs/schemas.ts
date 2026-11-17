import { z } from "zod";
import { AccountRoleSchema, type AccountRole } from "../accounts/schemas.js";

export const RUN_STATUSES = [
  "generating",
  "generated",
  "awaiting_approval",
  "dispatching",
  "dispatched",
  "published",
  "failed",
] as const;

export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CarouselSlideSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  position: z.coerce.number().int().min(1),
  storage_path: z.string().min(1),
  media_id: z.string().uuid().nullable().optional(),
});

export type CarouselSlide = z.infer<typeof CarouselSlideSchema>;

export const CarouselRunTikTokPostSchema = z.object({
  provider: z.string().nullable().optional(),
  external_post_id: z.string().nullable().optional(),
  publish_status: z.string().nullable().optional(),
  published_at: z.coerce.date().nullable().optional(),
  last_polled_at: z.coerce.date().nullable().optional(),
  video_url: z.string().nullable().optional(),
});

export const CarouselRunSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid().nullable().optional(),
  auto_post_slot_id: z.string().uuid().nullable().optional(),
  account_id: z.string().min(1),
  account_role: AccountRoleSchema,
  archetype_title: z.string().min(1),
  bait_body: z.string().nullable().optional(),
  tema: z.string().nullable().optional(),
  legenda: z.string(),
  status: RunStatusSchema.default("generating"),
  output_dir: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  generated_at: z.coerce.date().nullable().optional(),
  buffer_dispatched_at: z.coerce.date().nullable().optional(),
  created_at: z.coerce.date().optional(),
  updated_at: z.coerce.date().optional(),
  slides: z.array(CarouselSlideSchema).optional(),
  tiktok_post: CarouselRunTikTokPostSchema.nullable().optional(),
});

export type CarouselRun = z.infer<typeof CarouselRunSchema>;

export interface CreateCarouselRunInput {
  id?: string;
  job_id?: string | null;
  account_id: string;
  account_role: AccountRole;
  archetype_title: string;
  bait_body?: string | null;
  tema?: string | null;
  legenda: string;
  status?: RunStatus;
  output_dir?: string | null;
  error_message?: string | null;
  generated_at?: Date | null;
}

export interface CreateCarouselSlideInput {
  id?: string;
  run_id: string;
  position: number;
  storage_path: string;
  media_id?: string | null;
}

export interface ListCarouselRunsFilters {
  accountId?: string;
  jobId?: string;
  status?: RunStatus;
  limit?: number;
  offset?: number;
}

export const JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = (typeof JOB_STATUSES)[number];

export const GenerationJobSchema = z.object({
  id: z.string().uuid(),
  status: JobStatusSchema.default("pending"),
  account_ids: z.array(z.string()),
  started_at: z.coerce.date().nullable().optional(),
  finished_at: z.coerce.date().nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.coerce.date().optional(),
});

export type GenerationJob = z.infer<typeof GenerationJobSchema>;

export interface CreateGenerationJobInput {
  id?: string;
  status?: JobStatus;
  account_ids: string[];
  started_at?: Date | null;
  finished_at?: Date | null;
  error_message?: string | null;
}

export interface GenerationJobProgress extends GenerationJob {
  total: number;
  completed: number;
  failed: number;
  runs?: CarouselRun[];
}

export const GenerateCarouselsBodySchema = z.object({
  accountIds: z.array(z.string().min(1)).optional(),
  mockCopy: z.any().optional(),
  skipRender: z.boolean().optional(),
});

export type GenerateCarouselsBody = z.infer<typeof GenerateCarouselsBodySchema>;

export const ListCarouselRunsQuerySchema = z.object({
  accountId: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  jobId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  status: z
    .preprocess(
      (v) => (v === "" ? undefined : v),
      RunStatusSchema.optional()
    ),
  limit: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
  offset: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().min(0).optional()
  ),
});

export type ListCarouselRunsQuery = z.infer<typeof ListCarouselRunsQuerySchema>;

