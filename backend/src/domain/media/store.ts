import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import { isSiloEnabled, deleteMediaFromSilo } from "../../shared/storage/silo.js";
import type { ContentScope } from "../archetypes/schemas.js";
import type { AccountRole } from "../accounts/schemas.js";
import {
  MEDIA_SCOPES,
  validCategoriesForScope,
  getMediaRoot,
  safeResolveMediaPath,
  type MediaCategory,
} from "./paths.js";
import type { MediaAsset } from "./schemas.js";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export interface ListMediaFilters {
  scope?: ContentScope;
  category?: MediaCategory;
  active?: boolean;
}

export interface UpsertMediaAssetInput {
  scope: ContentScope;
  category: MediaCategory;
  storage_path: string;
  filename: string;
  byte_size?: number | null;
  width?: number | null;
  height?: number | null;
  active?: boolean;
}

/**
 * Extracts width and height from PNG or JPEG buffer without external dependencies.
 */
export function extractImageDimensions(buffer: Buffer): {
  width: number | null;
  height: number | null;
} {
  try {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer.length >= 24 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    // JPEG signature: FF D8
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const len = buffer.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
  } catch {
    // Fall back to null if parsing fails
  }

  return { width: null, height: null };
}

/**
 * Scans disk media directory and upserts media_assets into Postgres.
 * Returns the count of upserted assets.
 */
export async function scanMediaToDb(
  mediaRoot?: string,
  poolInstance?: Pool
): Promise<number> {
  const root = getMediaRoot(mediaRoot);
  const p = poolInstance || getPool();

  if (!fs.existsSync(root)) {
    return 0;
  }

  let count = 0;

  for (const scope of MEDIA_SCOPES) {
    if (scope === "listo") {
      const listoDir = path.join(root, "listo");
      if (fs.existsSync(listoDir)) {
        const entries = fs.readdirSync(listoDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || entry.name.startsWith(".")) continue;
          const ext = path.extname(entry.name).toLowerCase();
          if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) continue;

          const filePath = path.join(listoDir, entry.name);
          const stat = fs.statSync(filePath);
          const storagePath = path.posix.join("media", "listo", entry.name);

          let width: number | null = null;
          let height: number | null = null;
          try {
            const fd = fs.openSync(filePath, "r");
            const buffer = Buffer.alloc(Math.min(stat.size, 65536));
            fs.readSync(fd, buffer, 0, buffer.length, 0);
            fs.closeSync(fd);
            const dims = extractImageDimensions(buffer);
            width = dims.width;
            height = dims.height;
          } catch {
            // Ignore dimension read errors
          }

          await p.query(
            `INSERT INTO media_assets (scope, category, storage_path, filename, byte_size, width, height, active, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
             ON CONFLICT (storage_path) DO UPDATE SET
               scope = EXCLUDED.scope,
               category = EXCLUDED.category,
               filename = EXCLUDED.filename,
               byte_size = EXCLUDED.byte_size,
               width = COALESCE(EXCLUDED.width, media_assets.width),
               height = COALESCE(EXCLUDED.height, media_assets.height),
               active = true,
               updated_at = NOW()`,
            ["listo", "listo", storagePath, entry.name, stat.size, width, height]
          );

          count++;
        }
      }
      continue;
    }

    const categories = validCategoriesForScope(scope);

    for (const category of categories) {
      const categoryDir = path.join(root, scope, category);
      if (!fs.existsSync(categoryDir)) continue;

      const entries = fs.readdirSync(categoryDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith(".")) continue; // Skip .gitkeep, .DS_Store, etc.

        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) continue;

        const filePath = path.join(categoryDir, entry.name);
        const stat = fs.statSync(filePath);
        const storagePath = path.posix.join("media", scope, category, entry.name);

        let width: number | null = null;
        let height: number | null = null;
        try {
          // Read up to 64KB for header parsing to conserve memory
          const fd = fs.openSync(filePath, "r");
          const buffer = Buffer.alloc(Math.min(stat.size, 65536));
          fs.readSync(fd, buffer, 0, buffer.length, 0);
          fs.closeSync(fd);
          const dims = extractImageDimensions(buffer);
          width = dims.width;
          height = dims.height;
        } catch {
          // Ignore dimension read errors
        }

        await p.query(
          `INSERT INTO media_assets (scope, category, storage_path, filename, byte_size, width, height, active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
           ON CONFLICT (storage_path) DO UPDATE SET
             scope = EXCLUDED.scope,
             category = EXCLUDED.category,
             filename = EXCLUDED.filename,
             byte_size = EXCLUDED.byte_size,
             width = COALESCE(EXCLUDED.width, media_assets.width),
             height = COALESCE(EXCLUDED.height, media_assets.height),
             active = true,
             updated_at = NOW()`,
          [scope, category, storagePath, entry.name, stat.size, width, height]
        );

        count++;
      }
    }
  }

  return count;
}

function mapMediaAssetRow(row: any): MediaAsset {
  return {
    ...row,
    byte_size:
      row.byte_size !== null && row.byte_size !== undefined
        ? Number(row.byte_size)
        : null,
  };
}

/**
 * Lists media assets with optional filtering by scope, category, and active status.
 */
export async function listMediaAssets(
  filters: ListMediaFilters = {},
  poolInstance?: Pool
): Promise<MediaAsset[]> {
  const p = poolInstance || getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.scope) {
    params.push(filters.scope);
    conditions.push(`scope = $${params.length}`);
  }

  if (filters.category) {
    params.push(filters.category);
    conditions.push(`category = $${params.length}`);
  }

  if (filters.active !== undefined) {
    params.push(filters.active);
    conditions.push(`active = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `
    SELECT id, scope, category, storage_path, filename, byte_size, width, height, active, created_at, updated_at
    FROM media_assets
    ${whereClause}
    ORDER BY created_at DESC, filename ASC
  `;

  const result = await p.query(query, params);
  return result.rows.map(mapMediaAssetRow);
}

/**
 * Gets a single media asset by its storage path.
 */
export async function getMediaAssetByStoragePath(
  storagePath: string,
  poolInstance?: Pool
): Promise<MediaAsset | null> {
  const p = poolInstance || getPool();
  const normalized = storagePath.startsWith("media/")
    ? storagePath
    : path.posix.join("media", storagePath);

  const result = await p.query(
    `SELECT id, scope, category, storage_path, filename, byte_size, width, height, active, created_at, updated_at
     FROM media_assets
     WHERE storage_path = $1 OR storage_path = $2`,
    [storagePath, normalized]
  );

  return result.rows[0] ? mapMediaAssetRow(result.rows[0]) : null;
}

/**
 * Upserts a media asset into Postgres.
 */
export async function upsertMediaAsset(
  input: UpsertMediaAssetInput,
  poolInstance?: Pool
): Promise<MediaAsset> {
  const p = poolInstance || getPool();
  const active = input.active !== undefined ? input.active : true;

  const result = await p.query(
    `INSERT INTO media_assets (scope, category, storage_path, filename, byte_size, width, height, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (storage_path) DO UPDATE SET
       scope = EXCLUDED.scope,
       category = EXCLUDED.category,
       filename = EXCLUDED.filename,
       byte_size = EXCLUDED.byte_size,
       width = COALESCE(EXCLUDED.width, media_assets.width),
       height = COALESCE(EXCLUDED.height, media_assets.height),
       active = EXCLUDED.active,
       updated_at = NOW()
     RETURNING id, scope, category, storage_path, filename, byte_size, width, height, active, created_at, updated_at`,
    [
      input.scope,
      input.category,
      input.storage_path,
      input.filename,
      input.byte_size ?? null,
      input.width ?? null,
      input.height ?? null,
      active,
    ]
  );

  return mapMediaAssetRow(result.rows[0]);
}

/**
 * Deletes a media asset from Postgres and deletes its file from disk.
 */
export async function deleteMediaAsset(
  storagePath: string,
  mediaRoot?: string,
  poolInstance?: Pool
): Promise<void> {
  const p = poolInstance || getPool();
  const asset = await getMediaAssetByStoragePath(storagePath, p);

  if (!asset) {
    throw new AppError(`Media asset '${storagePath}' not found`, 404, "not_found");
  }

  // Delete from Postgres
  await p.query("DELETE FROM media_assets WHERE id = $1", [asset.id]);

  // Remove physical file from disk if it exists
  try {
    const diskPath = safeResolveMediaPath(asset.storage_path, mediaRoot);
    if (fs.existsSync(diskPath)) {
      fs.unlinkSync(diskPath);
    }
  } catch (err) {
    // If safeResolve fails or file doesn't exist, log and proceed
    console.warn(`[media:delete] Could not unlink disk file for '${storagePath}':`, err);
  }

  // Remove from Silo if enabled
  if (isSiloEnabled()) {
    try {
      await deleteMediaFromSilo(asset.storage_path);
    } catch (err) {
      console.warn(`[media:delete] Could not delete silo object for '${storagePath}':`, err);
    }
  }
}

/**
 * Returns the effective usageDays window, defaulting to 7 or the USAGE_DAYS environment variable.
 */
export function getUsageDays(override?: number): number {
  if (override !== undefined && !Number.isNaN(override)) {
    return override;
  }
  const fromEnv = Number(process.env.USAGE_DAYS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 7;
}

/**
 * Records usage of media assets for a carousel run in the media_usage table.
 */
export async function recordMediaUsage(
  runId: string,
  mediaIds: string[],
  poolInstance?: Pool,
  usedAt?: Date
): Promise<void> {
  if (!mediaIds || mediaIds.length === 0) {
    return;
  }

  const p = poolInstance || getPool();
  const uniqueMediaIds = [...new Set(mediaIds)];

  const values: string[] = [];
  const params: unknown[] = [runId];

  if (usedAt) {
    params.push(usedAt);
    const dateParamIdx = params.length;
    for (let i = 0; i < uniqueMediaIds.length; i++) {
      params.push(uniqueMediaIds[i]);
      values.push(`($${params.length}, $1, $${dateParamIdx})`);
    }
  } else {
    for (let i = 0; i < uniqueMediaIds.length; i++) {
      params.push(uniqueMediaIds[i]);
      values.push(`($${params.length}, $1, NOW())`);
    }
  }

  const query = `
    INSERT INTO media_usage (media_id, run_id, used_at)
    VALUES ${values.join(", ")}
    ON CONFLICT (media_id, run_id) DO UPDATE SET used_at = EXCLUDED.used_at
  `;

  await p.query(query, params);
}

/**
 * Returns a set of filenames of media assets recently used for a given role within the day window.
 */
export async function recentlyUsedFilenames(
  roleOrUsage: AccountRole | { entries?: Array<{ filename: string }> } | null | undefined,
  days?: number | Pool,
  poolInstance?: Pool
): Promise<Set<string>> {
  if (
    roleOrUsage &&
    typeof roleOrUsage === "object" &&
    !("length" in roleOrUsage) &&
    "entries" in roleOrUsage
  ) {
    return new Set((roleOrUsage.entries || []).map((e) => e.filename));
  }

  const role = roleOrUsage as AccountRole;
  let effectiveDays: number;
  let p: Pool;

  if (typeof days === "number") {
    effectiveDays = days;
    p = poolInstance || getPool();
  } else if (days && typeof days === "object" && "query" in days) {
    effectiveDays = getUsageDays();
    p = days as Pool;
  } else {
    effectiveDays = getUsageDays();
    p = poolInstance || getPool();
  }

  const query = `
    SELECT DISTINCT ma.filename
    FROM media_usage mu
    JOIN media_assets ma ON mu.media_id = ma.id
    JOIN carousel_runs cr ON mu.run_id = cr.id
    WHERE (cr.account_role::text = $1::text OR ma.scope::text = $1::text)
      AND mu.used_at >= NOW() - ($2 * INTERVAL '1 day')
    ORDER BY ma.filename ASC
  `;

  const result = await p.query(query, [role, effectiveDays]);
  return new Set(result.rows.map((row: { filename: string }) => row.filename));
}
