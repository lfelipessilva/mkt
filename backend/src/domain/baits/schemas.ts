import { z } from "zod";
import { ContentScopeSchema, type ContentScope } from "../archetypes/schemas.js";

export { ContentScopeSchema, type ContentScope };

export const BaitSchema = z.object({
  id: z.string().uuid(),
  scope: ContentScopeSchema,
  body: z.string().min(1),
  sort_order: z.number().int().default(0),
  active: z.boolean().default(true),
  created_at: z.coerce.date().optional(),
  updated_at: z.coerce.date().optional(),
});

export type Bait = z.infer<typeof BaitSchema>;

export const BaitItemInputSchema = z.object({
  id: z.string().uuid().optional(),
  body: z.string().min(1),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional().default(true),
});

export type BaitItemInput = z.infer<typeof BaitItemInputSchema>;

export const PutBaitsSchema = z.object({
  scope: ContentScopeSchema,
  items: z.array(BaitItemInputSchema),
});

export type PutBaitsInput = z.infer<typeof PutBaitsSchema>;

export const GetBaitsQuerySchema = z.object({
  scope: ContentScopeSchema.optional(),
});

export type GetBaitsQuery = z.infer<typeof GetBaitsQuerySchema>;
