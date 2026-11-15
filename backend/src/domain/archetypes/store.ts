import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import type {
  Archetype,
  ArchetypeItemInput,
  ContentScope,
} from "./schemas.js";

export async function listArchetypes(
  scope?: ContentScope,
  poolInstance?: Pool
): Promise<Archetype[]> {
  const p = poolInstance || getPool();

  if (scope) {
    const result = await p.query<Archetype>(
      `SELECT id, scope, title, sort_order, active, created_at, updated_at
       FROM archetypes
       WHERE scope = $1
       ORDER BY sort_order ASC, created_at ASC, id ASC`,
      [scope]
    );
    return result.rows;
  }

  const result = await p.query<Archetype>(
    `SELECT id, scope, title, sort_order, active, created_at, updated_at
     FROM archetypes
     ORDER BY scope ASC, sort_order ASC, created_at ASC, id ASC`
  );
  return result.rows;
}

export async function getArchetype(
  id: string,
  poolInstance?: Pool
): Promise<Archetype | null> {
  const p = poolInstance || getPool();
  const result = await p.query<Archetype>(
    `SELECT id, scope, title, sort_order, active, created_at, updated_at
     FROM archetypes
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function replaceArchetypesForScope(
  scope: ContentScope,
  items: ArchetypeItemInput[],
  poolInstance?: Pool
): Promise<Archetype[]> {
  const p = poolInstance || getPool();
  const client = await p.connect();

  try {
    await client.query("BEGIN");

    const keptIds: string[] = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const id = item.id || crypto.randomUUID();
      const sortOrder = item.sort_order !== undefined ? item.sort_order : index;
      const active = item.active !== undefined ? item.active : true;

      const result = await client.query<Archetype>(
        `INSERT INTO archetypes (id, scope, title, sort_order, active, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (scope, title) DO UPDATE SET
           sort_order = EXCLUDED.sort_order,
           active = EXCLUDED.active,
           updated_at = NOW()
         RETURNING id, scope, title, sort_order, active, created_at, updated_at`,
        [id, scope, item.title, sortOrder, active]
      );

      const saved = result.rows[0];
      if (saved && !keptIds.includes(saved.id)) {
        keptIds.push(saved.id);
      }
    }

    if (keptIds.length === 0) {
      await client.query("DELETE FROM archetypes WHERE scope = $1", [scope]);
    } else {
      await client.query(
        "DELETE FROM archetypes WHERE scope = $1 AND NOT (id = ANY($2::uuid[]))",
        [scope, keptIds]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return listArchetypes(scope, p);
}

export async function deleteArchetype(
  id: string,
  poolInstance?: Pool
): Promise<void> {
  const p = poolInstance || getPool();
  const res = await p.query("DELETE FROM archetypes WHERE id = $1", [id]);
  if (res.rowCount === 0) {
    throw new AppError(`Archetype '${id}' not found`, 404, "not_found");
  }
}
