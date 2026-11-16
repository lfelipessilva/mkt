import fs from "node:fs";
import path from "node:path";
import { AppError } from "../../shared/errors.js";
import type { ContentScope } from "../archetypes/schemas.js";

export const MEDIA_SCOPES = [
  "shared",
  "single_man",
  "single_woman",
  "couple_men",
  "couple_women",
  "listo",
] as const;

export const MEDIA_CATEGORIES = [
  "cover",
  "random",
  "listo",
  "capas",
  "aleatorias",
] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const CATEGORIES_BY_SCOPE: Record<ContentScope, readonly MediaCategory[]> = {
  shared: ["random", "aleatorias", "listo"],
  single_man: ["cover", "random", "capas", "aleatorias"],
  single_woman: ["cover", "random", "capas", "aleatorias"],
  couple_men: ["cover", "random", "capas", "aleatorias"],
  couple_women: ["cover", "random", "capas", "aleatorias"],
  listo: ["listo"],
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

/**
 * Resolves the absolute media root directory based on options, env, or working directory.
 */
export function getMediaRoot(customRoot?: string): string {
  if (customRoot) return path.resolve(customRoot);
  if (process.env.MEDIA_ROOT) return path.resolve(process.env.MEDIA_ROOT);
  const cwdMedia = path.resolve(process.cwd(), "media");
  if (fs.existsSync(cwdMedia)) return cwdMedia;
  const parentMedia = path.resolve(process.cwd(), "../media");
  if (fs.existsSync(parentMedia)) return parentMedia;
  return cwdMedia;
}

/**
 * Resolves the absolute output root directory.
 */
export function getOutputDir(customRoot?: string): string {
  if (customRoot) return path.resolve(customRoot);
  if (process.env.OUTPUT_DIR) return path.resolve(process.env.OUTPUT_DIR);
  const cwdOutput = path.resolve(process.cwd(), "output");
  if (fs.existsSync(cwdOutput)) return cwdOutput;
  const parentOutput = path.resolve(process.cwd(), "../output");
  if (fs.existsSync(parentOutput)) return parentOutput;
  return cwdOutput;
}

/**
 * Safely resolves a media path against the media root directory (or output root for generated slides),
 * preventing any path traversal.
 */
export function safeResolveMediaPath(inputPath: string, mediaRoot?: string): string {
  if (!inputPath || typeof inputPath !== "string" || !inputPath.trim()) {
    throw new AppError("Media path parameter is required", 400, "invalid_path");
  }

  const raw = inputPath.trim().replace(/\\/g, "/");

  // Output directory check for generated slide images
  const outRoot = getOutputDir();
  const normalizedOutRoot = outRoot.replace(/\\/g, "/");
  if (
    raw.startsWith("output/") ||
    raw.startsWith("/output/") ||
    (raw.startsWith("/") && raw.startsWith(normalizedOutRoot))
  ) {
    let cleanOutput = raw;
    if (cleanOutput.startsWith("/output/")) {
      cleanOutput = cleanOutput.slice(8);
    } else if (cleanOutput.startsWith("output/")) {
      cleanOutput = cleanOutput.slice(7);
    } else if (cleanOutput.startsWith(normalizedOutRoot)) {
      cleanOutput = cleanOutput.slice(normalizedOutRoot.length);
      if (cleanOutput.startsWith("/")) cleanOutput = cleanOutput.slice(1);
    }

    const resolvedOutput = path.resolve(outRoot, cleanOutput);
    const relOutput = path.relative(outRoot, resolvedOutput);
    if (relOutput.startsWith("..") || path.isAbsolute(relOutput)) {
      throw new AppError(
        `Path traversal rejected: path '${inputPath}' resolves outside output root`,
        400,
        "invalid_path"
      );
    }
    return resolvedOutput;
  }

  // Reject explicit absolute system paths unless prefixed by /media/
  if (raw.startsWith("/") && !raw.startsWith("/media/")) {
    throw new AppError(
      `Path traversal rejected: absolute path '${inputPath}' not allowed`,
      400,
      "invalid_path"
    );
  }

  // Strip leading media/ or /media/ to resolve relative to media root
  let cleaned = raw;
  if (cleaned.startsWith("/media/")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("media/")) {
    cleaned = cleaned.slice(6);
  }

  const root = getMediaRoot(mediaRoot);
  const resolved = path.resolve(root, cleaned);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new AppError(
      `Path traversal rejected: path '${inputPath}' resolves outside media root`,
      400,
      "invalid_path"
    );
  }

  return resolved;
}

/**
 * Returns Content-Type header based on file extension.
 */
export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
