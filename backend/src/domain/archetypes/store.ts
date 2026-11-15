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
      const sortOrder = item.sort_order !== undefined ? item.sort_order : index;
      const active = item.active !== undefined ? item.active : true;

      let existingId: string | null = null;

      if (item.id) {
        const checkById = await client.query<{ id: string }>(
          `SELECT id FROM archetypes WHERE id = $1 AND scope = $2`,
          [item.id, scope]
        );
        if (checkById.rows[0]) {
          existingId = checkById.rows[0].id;
        }
      }

      if (!existingId) {
        const checkByTitle = await client.query<{ id: string }>(
          `SELECT id FROM archetypes WHERE scope = $1 AND title = $2 LIMIT 1`,
          [scope, item.title]
        );
        if (checkByTitle.rows[0]) {
          existingId = checkByTitle.rows[0].id;
        }
      }

      let savedId: string;

      if (existingId) {
        const updateRes = await client.query<Archetype>(
          `UPDATE archetypes
           SET title = $1, sort_order = $2, active = $3, updated_at = NOW()
           WHERE id = $4
           RETURNING id`,
          [item.title, sortOrder, active, existingId]
        );
        savedId = updateRes.rows[0].id;
      } else {
        const insertId = item.id || crypto.randomUUID();
        const insertRes = await client.query<Archetype>(
          `INSERT INTO archetypes (id, scope, title, sort_order, active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           RETURNING id`,
          [insertId, scope, item.title, sortOrder, active]
        );
        savedId = insertRes.rows[0].id;
      }

      if (savedId && !keptIds.includes(savedId)) {
        keptIds.push(savedId);
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
