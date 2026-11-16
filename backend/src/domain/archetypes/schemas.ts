import { z } from "zod";

export const ContentScopeSchema = z.enum([
  "shared",
  "single_man",
  "single_woman",
  "couple_men",
  "couple_women",
  "listo",
]);

export type ContentScope = z.infer<typeof ContentScopeSchema>;

export const ArchetypeSchema = z.object({
  id: z.string().uuid(),
  scope: ContentScopeSchema,
  title: z.string().min(1),
  sort_order: z.number().int().default(0),
  active: z.boolean().default(true),
  created_at: z.coerce.date().optional(),
  updated_at: z.coerce.date().optional(),
});

export type Archetype = z.infer<typeof ArchetypeSchema>;

export const ArchetypeItemInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional().default(true),
});

export type ArchetypeItemInput = z.infer<typeof ArchetypeItemInputSchema>;

export const PutArchetypesSchema = z.object({
  scope: ContentScopeSchema,
  items: z.array(ArchetypeItemInputSchema),
});

export type PutArchetypesInput = z.infer<typeof PutArchetypesSchema>;

export const GetArchetypesQuerySchema = z.object({
  scope: ContentScopeSchema.optional(),
});

export type GetArchetypesQuery = z.infer<typeof GetArchetypesQuerySchema>;
