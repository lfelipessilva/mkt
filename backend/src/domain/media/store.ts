import path from "node:path";
import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import {
  isSiloEnabled,
  deleteMediaFromSilo,
  getSiloConfig,
  listSiloObjectEntries,
} from "../../shared/storage/silo.js";
import type { ContentScope } from "../archetypes/schemas.js";
import type { AccountRole } from "../accounts/schemas.js";
import {
  MEDIA_SCOPES,
  validCategoriesForScope,
  parseSiloMediaKey,
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
 * Lists objects from the Silo media bucket and upserts media_assets.
 * Deactivates DB rows whose storage_path is not present in Silo.
 * Returns the count of upserted assets.
 */
export async function scanSiloMediaToDb(poolInstance?: Pool): Promise<number> {
  if (!isSiloEnabled()) {
    return 0;
  }

  const config = getSiloConfig();
  if (!config) return 0;

  const p = poolInstance || getPool();
  const entries = await listSiloObjectEntries(config.mediaBucket);
  const seenPaths = new Set<string>();
  let count = 0;

  for (const entry of entries) {
    const parsed = parseSiloMediaKey(entry.key);
    if (!parsed) continue;

    seenPaths.add(parsed.storage_path);
    await upsertMediaAsset(
      {
        scope: parsed.scope,
        category: parsed.category,
        storage_path: parsed.storage_path,
        filename: parsed.filename,
        byte_size: entry.size || null,
        active: true,
      },
      p
    );
    count++;
  }

  if (seenPaths.size > 0) {
    await p.query(
      `UPDATE media_assets
       SET active = false, updated_at = NOW()
       WHERE active = true
         AND NOT (storage_path = ANY($1::text[]))`,
      [Array.from(seenPaths)]
    );
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
 * Lists active media assets for given scopes and category, mapped to { filename, path }.
 * Slide path matches storage_path.
 */
export async function listActiveMediaImages(
  scopes: (ContentScope | string)[],
  category: MediaCategory | string,
  poolInstance?: Pool
): Promise<Array<{ filename: string; path: string }>> {
  const p = poolInstance || getPool();
  const canonical =
    category === "capas" ? "cover" : category === "aleatorias" ? "random" : category;
  const result = await p.query<{ filename: string; storage_path: string }>(
    `SELECT filename, storage_path
     FROM media_assets
     WHERE active = true
       AND scope = ANY($1::text[])
       AND (
         category = $2
         OR ($2 = 'cover' AND category = 'capas')
         OR ($2 = 'random' AND category = 'aleatorias')
       )
     ORDER BY filename ASC`,
    [scopes, canonical]
  );
  return result.rows.map((row) => ({
    filename: row.filename,
    path: row.storage_path,
  }));
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
 * Deletes a media asset from Postgres and Silo.
 */
export async function deleteMediaAsset(
  storagePath: string,
  _mediaRoot?: string,
  poolInstance?: Pool
): Promise<void> {
  const p = poolInstance || getPool();
  const asset = await getMediaAssetByStoragePath(storagePath, p);

  if (!asset) {
    throw new AppError(`Media asset '${storagePath}' not found`, 404, "not_found");
  }

  // Delete from Postgres
  await p.query("DELETE FROM media_assets WHERE id = $1", [asset.id]);

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
