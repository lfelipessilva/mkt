import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import type { Account, AccountRole } from "./schemas.js";

export interface UpsertAccountInput {
  id?: string;
  display_name?: string | null;
  persona?: string;
  role?: AccountRole;
  enabled?: boolean;
  auto_post_enabled?: boolean;
  tiktok_open_id?: string | null;
  social_provider?: string | null;
  external_account_id?: string | null;
  social_account_metadata?: Record<string, unknown>;
  zernio_api_key?: string | null;
}

export async function listAccounts(poolInstance?: Pool): Promise<Account[]> {
  const p = poolInstance || getPool();
  const result = await p.query<Account>(
    `SELECT id, display_name, persona, role, enabled, auto_post_enabled, tiktok_open_id,
            social_provider, external_account_id, social_account_metadata, zernio_api_key,
            created_at, updated_at
     FROM accounts
     ORDER BY created_at ASC, id ASC`
  );
  return result.rows;
}

export async function getAccount(
  id: string,
  poolInstance?: Pool
): Promise<Account | null> {
  const p = poolInstance || getPool();
  const result = await p.query<Account>(
    `SELECT id, display_name, persona, role, enabled, auto_post_enabled, tiktok_open_id,
            social_provider, external_account_id, social_account_metadata, zernio_api_key,
            created_at, updated_at
     FROM accounts
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function upsertAccount(
  input: UpsertAccountInput,
  poolInstance?: Pool
): Promise<Account> {
  const p = poolInstance || getPool();
  const id = input.id || crypto.randomUUID();
  const existing = await getAccount(id, p);

  const displayName =
    input.display_name !== undefined
      ? input.display_name
      : (existing?.display_name ?? null);
  const persona =
    input.persona !== undefined ? input.persona : (existing?.persona ?? "");
  const role =
    input.role !== undefined ? input.role : (existing?.role ?? "single_woman");
  const enabled =
    input.enabled !== undefined ? input.enabled : (existing?.enabled ?? true);
  const autoPostEnabled =
    input.auto_post_enabled !== undefined
      ? input.auto_post_enabled
      : (existing?.auto_post_enabled ?? true);
  const tiktokOpenId =
    input.tiktok_open_id !== undefined
      ? input.tiktok_open_id
      : (existing?.tiktok_open_id ?? null);
  const socialProvider =
    input.social_provider !== undefined
      ? input.social_provider
      : (existing?.social_provider ?? null);
  const externalAccountId =
    input.external_account_id !== undefined
      ? input.external_account_id
      : (existing?.external_account_id ?? null);
  const socialAccountMetadata =
    input.social_account_metadata !== undefined
      ? JSON.stringify(input.social_account_metadata)
      : (existing?.social_account_metadata !== undefined
          ? JSON.stringify(existing.social_account_metadata)
          : "{}");
  const zernioApiKey =
    input.zernio_api_key !== undefined
      ? input.zernio_api_key
      : (existing?.zernio_api_key ?? null);

  const result = await p.query<Account>(
    `INSERT INTO accounts (id, display_name, persona, role, enabled, auto_post_enabled, tiktok_open_id, social_provider, external_account_id, social_account_metadata, zernio_api_key, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       persona = EXCLUDED.persona,
       role = EXCLUDED.role,
       enabled = EXCLUDED.enabled,
       auto_post_enabled = EXCLUDED.auto_post_enabled,
       tiktok_open_id = EXCLUDED.tiktok_open_id,
       social_provider = EXCLUDED.social_provider,
       external_account_id = EXCLUDED.external_account_id,
       social_account_metadata = EXCLUDED.social_account_metadata,
       zernio_api_key = EXCLUDED.zernio_api_key,
       updated_at = NOW()
     RETURNING id, display_name, persona, role, enabled, auto_post_enabled, tiktok_open_id, social_provider, external_account_id, social_account_metadata, zernio_api_key, created_at, updated_at`,
    [id, displayName, persona, role, enabled, autoPostEnabled, tiktokOpenId, socialProvider, externalAccountId, socialAccountMetadata, zernioApiKey]
  );

  return result.rows[0];
}

export async function deleteAccount(
  id: string,
  poolInstance?: Pool
): Promise<void> {
  const p = poolInstance || getPool();
  const res = await p.query("DELETE FROM accounts WHERE id = $1", [id]);
  if (res.rowCount === 0) {
    throw new AppError(`Account '${id}' not found`, 404, "not_found");
  }
}
