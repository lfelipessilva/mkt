import fs from "node:fs";
import os from "node:os";
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

export const MEDIA_CATEGORIES = ["cover", "random", "listo"] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const CATEGORIES_BY_SCOPE: Record<ContentScope, readonly MediaCategory[]> = {
  shared: ["random"],
  single_man: ["cover", "random"],
  single_woman: ["cover", "random"],
  couple_men: ["cover", "random"],
  couple_women: ["cover", "random"],
  listo: ["listo"],
};

export function scopeToDir(scope: ContentScope, baseDir = "media"): string {
  return path.posix.join(baseDir, scope);
}

export function validCategoriesForScope(scope: ContentScope): readonly MediaCategory[] {
  return CATEGORIES_BY_SCOPE[scope] ?? [];
}

const CANONICAL_CATEGORY: Record<string, MediaCategory> = {
  cover: "cover",
  capas: "cover",
  random: "random",
  aleatorias: "random",
  listo: "listo",
};

export function parseSiloMediaKey(key: string): {
  scope: ContentScope;
  category: MediaCategory;
  filename: string;
  storage_path: string;
} | null {
  const clean = key.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!clean || clean.endsWith("/")) return null;

  const ext = path.posix.extname(clean).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return null;

  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  if (parts[0] === "listo") {
    const filename = parts.slice(1).join("/");
    if (!filename || filename.includes("..")) return null;
    return {
      scope: "listo",
      category: "listo",
      filename,
      storage_path: path.posix.join("media", "listo", filename),
    };
  }

  if (parts.length < 3) return null;
  const scope = parts[0];
  if (!(MEDIA_SCOPES as readonly string[]).includes(scope)) return null;

  const category = CANONICAL_CATEGORY[parts[1]];
  if (!category) return null;

  const filename = parts.slice(2).join("/");
  if (!filename || filename.includes("..")) return null;

  return {
    scope: scope as ContentScope,
    category,
    filename,
    storage_path: path.posix.join("media", scope, category, filename),
  };
}

export function getOutputDir(customRoot?: string): string {
  if (customRoot) return path.resolve(customRoot);
  if (process.env.OUTPUT_DIR) return path.resolve(process.env.OUTPUT_DIR);
  return path.join(os.tmpdir(), "listo-carousels");
}

export function toPortableOutputPath(absolutePath: string, outputRoot?: string): string {
  const root = getOutputDir(outputRoot).replace(/\\/g, "/");
  const abs = path.resolve(absolutePath).replace(/\\/g, "/");
  const rel = path.posix.relative(root, abs);
  if (rel.startsWith("..") || path.posix.isAbsolute(rel)) {
    const marker = "/output/";
    const idx = abs.lastIndexOf(marker);
    if (idx >= 0) return `output/${abs.slice(idx + marker.length)}`;
    return path.posix.join("output", path.posix.basename(path.posix.dirname(abs)), path.posix.basename(abs));
  }
  return path.posix.join("output", rel);
}

export function isCarouselStoragePath(inputPath: string): boolean {
  const raw = inputPath.trim().replace(/\\/g, "/");
  return (
    raw.startsWith("output/") ||
    raw.startsWith("/output/") ||
    raw.includes("/output/")
  );
}

export function safeResolveMediaPath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== "string" || !inputPath.trim()) {
    throw new AppError("Media path parameter is required", 400, "invalid_path");
  }

  const raw = inputPath.trim().replace(/\\/g, "/");
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

  if (path.isAbsolute(raw) && fs.existsSync(raw)) {
    return raw;
  }

  throw new AppError(
    `Local media paths are not supported; use Silo storage keys: '${inputPath}'`,
    400,
    "invalid_path"
  );
}

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
