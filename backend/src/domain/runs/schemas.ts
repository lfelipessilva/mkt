import { z } from "zod";
import { AccountRoleSchema, type AccountRole } from "../accounts/schemas.js";

export const RUN_STATUSES = [
  "generating",
  "generated",
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

export const CarouselRunSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid().nullable().optional(),
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
  created_at: z.coerce.date().optional(),
  updated_at: z.coerce.date().optional(),
  slides: z.array(CarouselSlideSchema).optional(),
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
