import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import type { Archetype, ContentScope } from "../archetypes/schemas.js";
import type { Bait } from "../baits/schemas.js";
import type { AccountRole } from "../accounts/schemas.js";
import { getAccount } from "../accounts/store.js";

export interface EffectiveContent {
  archetypes: Archetype[];
  baits: Bait[];
  role: AccountRole;
}

export interface LoadEffectiveOptions {
  activeOnly?: boolean;
}

/**
 * Normalizes title for deduplication comparison.
 */
export function normalizeArchetypeTitle(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Normalizes bait body for deduplication comparison.
 */
export function normalizeBaitBody(body: string): string {
  return body.trim().toLowerCase();
}

/**
 * Scopes relevant for an account role: ["shared", role].
 */
export function scopesForRole(role: AccountRole): [ContentScope, ContentScope] {
  return ["shared", role];
}

/**
 * Merges shared archetypes and role archetypes.
 * Deduplicates by title, with role winning on conflicts.
 */
export function mergeArchetypes(
  sharedRows: Archetype[],
  roleRows: Archetype[]
): Archetype[] {
  const seenRoleKeys = new Set<string>();
  const dedupedRoleRows: Archetype[] = [];

  for (const row of roleRows) {
    const key = normalizeArchetypeTitle(row.title);
    if (!seenRoleKeys.has(key)) {
      seenRoleKeys.add(key);
      dedupedRoleRows.push(row);
    }
  }

  const filteredShared = sharedRows.filter(
    (row) => !seenRoleKeys.has(normalizeArchetypeTitle(row.title))
  );

  return [...filteredShared, ...dedupedRoleRows];
}

/**
 * Merges shared baits and role baits.
 * Deduplicates by body.trim().toLowerCase(), with role winning on conflicts.
 */
export function mergeBaits(
  sharedRows: Bait[],
  roleRows: Bait[]
): Bait[] {
  const seenRoleKeys = new Set<string>();
  const dedupedRoleRows: Bait[] = [];

  for (const row of roleRows) {
    const key = normalizeBaitBody(row.body);
    if (!seenRoleKeys.has(key)) {
      seenRoleKeys.add(key);
      dedupedRoleRows.push(row);
    }
  }

  const filteredShared = sharedRows.filter(
    (row) => !seenRoleKeys.has(normalizeBaitBody(row.body))
  );

  return [...filteredShared, ...dedupedRoleRows];
}

/**
 * Loads effective content (archetypes and baits) for an account from the database.
 * Merges shared scope and account role scope, with role winning on duplicates.
 */
export async function loadEffectiveForAccount(
  accountId: string,
  poolOrOptions?: Pool | LoadEffectiveOptions,
  maybeOptions?: LoadEffectiveOptions
): Promise<EffectiveContent> {
  let pool: Pool;
  let options: LoadEffectiveOptions;

  if (poolOrOptions && "query" in poolOrOptions) {
    pool = poolOrOptions as Pool;
    options = maybeOptions ?? {};
  } else {
    pool = getPool();
    options = (poolOrOptions as LoadEffectiveOptions) ?? maybeOptions ?? {};
  }

  const activeOnly = options.activeOnly !== false;

  const account = await getAccount(accountId, pool);
  if (!account) {
    throw new AppError(`Account '${accountId}' not found`, 404, "not_found");
  }

  const role = account.role;

  const archetypeQuery = activeOnly
    ? `SELECT id, scope, title, sort_order, active, created_at, updated_at
       FROM archetypes
       WHERE scope IN ('shared', $1) AND active = true
       ORDER BY sort_order ASC, created_at ASC, id ASC`
    : `SELECT id, scope, title, sort_order, active, created_at, updated_at
       FROM archetypes
       WHERE scope IN ('shared', $1)
       ORDER BY sort_order ASC, created_at ASC, id ASC`;

  const archetypesRes = await pool.query<Archetype>(archetypeQuery, [role]);
  const sharedArchetypes = archetypesRes.rows.filter((r) => r.scope === "shared");
  const roleArchetypes = archetypesRes.rows.filter((r) => r.scope === role);
  const archetypes = mergeArchetypes(sharedArchetypes, roleArchetypes);

  const baitQuery = activeOnly
    ? `SELECT id, scope, body, sort_order, active, created_at, updated_at
       FROM baits
       WHERE scope IN ('shared', $1) AND active = true
       ORDER BY sort_order ASC, created_at ASC, id ASC`
    : `SELECT id, scope, body, sort_order, active, created_at, updated_at
       FROM baits
       WHERE scope IN ('shared', $1)
       ORDER BY sort_order ASC, created_at ASC, id ASC`;

  const baitsRes = await pool.query<Bait>(baitQuery, [role]);
  const sharedBaits = baitsRes.rows.filter((r) => r.scope === "shared");
  const roleBaits = baitsRes.rows.filter((r) => r.scope === role);
  const baits = mergeBaits(sharedBaits, roleBaits);

  return {
    archetypes,
    baits,
    role,
  };
}
