import { z } from "zod";

export const AccountRoleSchema = z.enum([
  "single_man",
  "single_woman",
  "couple_men",
  "couple_women",
]);

export type AccountRole = z.infer<typeof AccountRoleSchema>;

export const AccountSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().nullable().optional(),
  persona: z.string(),
  role: AccountRoleSchema,
  enabled: z.boolean().default(true),
  auto_post_enabled: z.boolean().default(true),
  tiktok_open_id: z.string().nullable().optional(),
  social_provider: z.string().nullable().optional(),
  external_account_id: z.string().nullable().optional(),
  social_account_metadata: z.record(z.string(), z.unknown()).optional(),
  zernio_api_key: z.string().nullable().optional(),
  created_at: z.coerce.date().optional(),
  updated_at: z.coerce.date().optional(),
});

export type Account = z.infer<typeof AccountSchema>;

export const CreateAccountSchema = z.object({
  id: z.string().min(1).optional(),
  display_name: z.string().nullable().optional(),
  persona: z.string().default(""),
  role: AccountRoleSchema,
  enabled: z.boolean().default(true),
  auto_post_enabled: z.boolean().default(true),
  tiktok_open_id: z.string().nullable().optional(),
  external_account_id: z.string().nullable().optional(),
  social_provider: z.string().nullable().optional(),
  social_account_metadata: z.record(z.string(), z.unknown()).optional(),
  zernio_api_key: z.string().nullable().optional(),
});

export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;

export const UpdateAccountSchema = z.object({
  id: z.string().min(1).optional(),
  display_name: z.string().nullable().optional(),
  persona: z.string().optional(),
  role: AccountRoleSchema.optional(),
  enabled: z.boolean().optional(),
  auto_post_enabled: z.boolean().optional(),
  tiktok_open_id: z.string().nullable().optional(),
  external_account_id: z.string().nullable().optional(),
  social_provider: z.string().nullable().optional(),
  social_account_metadata: z.record(z.string(), z.unknown()).optional(),
  zernio_api_key: z.string().nullable().optional(),
});

export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;
