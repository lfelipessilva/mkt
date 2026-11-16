import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";

export async function getSetting<T = any>(key: string, poolInstance?: Pool): Promise<T | null> {
  const p = poolInstance || getPool();
  const res = await p.query<{ value: T }>(
    "SELECT value FROM app_settings WHERE key = $1 LIMIT 1",
    [key]
  );
  if (!res.rows[0]) return null;
  return res.rows[0].value;
}

export async function getAllSettings(poolInstance?: Pool): Promise<Record<string, any>> {
  const p = poolInstance || getPool();
  const res = await p.query<{ key: string; value: any }>(
    "SELECT key, value FROM app_settings ORDER BY key ASC"
  );
  const result: Record<string, any> = {};
  for (const row of res.rows) {
    result[row.key] = row.value;
  }
  return result;
}

export async function setSetting(
  key: string,
  value: any,
  poolInstance?: Pool
): Promise<{ key: string; value: any; updated_at: Date }> {
  const p = poolInstance || getPool();
  const res = await p.query<{ key: string; value: any; updated_at: Date }>(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()
     RETURNING key, value, updated_at`,
    [key, JSON.stringify(value)]
  );
  return res.rows[0];
}
