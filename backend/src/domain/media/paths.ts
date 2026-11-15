import path from "node:path";
import type { ContentScope } from "../archetypes/schemas.js";

export const MEDIA_SCOPES = [
  "shared",
  "single_man",
  "single_woman",
  "couple_men",
  "couple_women",
] as const;

export const MEDIA_CATEGORIES = ["capas", "aleatorias", "listo"] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const CATEGORIES_BY_SCOPE: Record<ContentScope, readonly MediaCategory[]> = {
  shared: ["aleatorias", "listo"],
  single_man: ["capas", "aleatorias"],
  single_woman: ["capas", "aleatorias"],
  couple_men: ["capas", "aleatorias"],
  couple_women: ["capas", "aleatorias"],
};

/**
 * Maps a ContentScope to its directory path relative to the media root or custom base dir.
 *
 * Defaults to "media/<scope>".
 */
export function scopeToDir(scope: ContentScope, baseDir = "media"): string {
  return path.posix.join(baseDir, scope);
}

/**
 * Returns valid categories for a given scope.
 */
export function validCategoriesForScope(scope: ContentScope): readonly MediaCategory[] {
  return CATEGORIES_BY_SCOPE[scope] ?? [];
}
