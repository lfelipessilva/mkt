import { z } from "zod";
import { ContentScopeSchema, type ContentScope } from "../archetypes/schemas.js";
import { MEDIA_CATEGORIES, type MediaCategory } from "./paths.js";

export const MediaCategorySchema = z.enum(MEDIA_CATEGORIES);

export const MediaAssetSchema = z.object({
  id: z.string().uuid(),
  scope: ContentScopeSchema,
  category: MediaCategorySchema,
  storage_path: z.string().min(1),
  filename: z.string().min(1),
  byte_size: z.coerce.number().nullable().optional(),
  width: z.coerce.number().int().nullable().optional(),
  height: z.coerce.number().int().nullable().optional(),
  active: z.boolean().default(true),
  created_at: z.coerce.date().optional(),
  updated_at: z.coerce.date().optional(),
});

export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const GetMediaQuerySchema = z.object({
  scope: ContentScopeSchema.optional(),
  category: MediaCategorySchema.optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((val) => (val === undefined ? true : val === "true")),
});

export type GetMediaQuery = z.infer<typeof GetMediaQuerySchema>;

export const DeleteMediaSchema = z.object({
  storage_path: z.string().min(1),
});

export type DeleteMediaInput = z.infer<typeof DeleteMediaSchema>;

export const GetMediaFileQuerySchema = z.object({
  path: z.string().min(1),
});

export type GetMediaFileQuery = z.infer<typeof GetMediaFileQuerySchema>;

export const UploadMediaFieldsSchema = z.object({
  scope: ContentScopeSchema,
  category: MediaCategorySchema,
});

export type UploadMediaFields = z.infer<typeof UploadMediaFieldsSchema>;
