import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import type {
  CarouselRun,
  CarouselSlide,
  CreateCarouselRunInput,
  CreateCarouselSlideInput,
  ListCarouselRunsFilters,
} from "./schemas.js";

function mapCarouselRunRow(row: any): CarouselRun {
  return {
    id: row.id,
    job_id: row.job_id ?? null,
    account_id: row.account_id,
    account_role: row.account_role,
    archetype_title: row.archetype_title,
    bait_body: row.bait_body ?? null,
    tema: row.tema ?? null,
    legenda: row.legenda,
    status: row.status,
    output_dir: row.output_dir ?? null,
    error_message: row.error_message ?? null,
    generated_at: row.generated_at ? new Date(row.generated_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

function mapCarouselSlideRow(row: any): CarouselSlide {
  return {
    id: row.id,
    run_id: row.run_id,
    position: Number(row.position),
    storage_path: row.storage_path,
    media_id: row.media_id ?? null,
  };
}

export async function createCarouselRun(
  input: CreateCarouselRunInput,
  poolInstance?: Pool
): Promise<CarouselRun> {
  const p = poolInstance || getPool();
  const status = input.status || "generating";

  const result = await p.query(
    `INSERT INTO carousel_runs (
      ${input.id ? "id, " : ""}job_id, account_id, account_role, archetype_title,
      bait_body, tema, legenda, status, output_dir, error_message, generated_at
    )
    VALUES (${input.id ? "$12, " : ""}$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id, job_id, account_id, account_role, archetype_title, bait_body, tema,
              legenda, status, output_dir, error_message, generated_at, created_at, updated_at`,
    [
      input.job_id ?? null,
      input.account_id,
      input.account_role,
      input.archetype_title,
      input.bait_body ?? null,
      input.tema ?? null,
      input.legenda,
      status,
      input.output_dir ?? null,
      input.error_message ?? null,
      input.generated_at ?? null,
      ...(input.id ? [input.id] : []),
    ]
  );

  return mapCarouselRunRow(result.rows[0]);
}

export async function getCarouselSlides(
  runId: string,
  poolInstance?: Pool
): Promise<CarouselSlide[]> {
  const p = poolInstance || getPool();
  const result = await p.query(
    `SELECT id, run_id, position, storage_path, media_id
     FROM carousel_slides
     WHERE run_id = $1
     ORDER BY position ASC`,
    [runId]
  );
  return result.rows.map(mapCarouselSlideRow);
}

export async function getCarouselRun(
  id: string,
  poolInstance?: Pool
): Promise<CarouselRun | null> {
  const p = poolInstance || getPool();
  const result = await p.query(
    `SELECT id, job_id, account_id, account_role, archetype_title, bait_body, tema,
            legenda, status, output_dir, error_message, generated_at, created_at, updated_at
     FROM carousel_runs
     WHERE id = $1`,
    [id]
  );
  if (!result.rows[0]) return null;

  const run = mapCarouselRunRow(result.rows[0]);
  run.slides = await getCarouselSlides(run.id, p);
  return run;
}

export async function createCarouselSlides(
  slides: CreateCarouselSlideInput[],
  poolInstance?: Pool
): Promise<CarouselSlide[]> {
  if (slides.length === 0) return [];
  const p = poolInstance || getPool();

  const values: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const offset = params.length;
    params.push(s.run_id, s.position, s.storage_path, s.media_id ?? null);
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
  }

  const query = `
    INSERT INTO carousel_slides (run_id, position, storage_path, media_id)
    VALUES ${values.join(", ")}
    RETURNING id, run_id, position, storage_path, media_id
  `;

  const result = await p.query(query, params);
  return result.rows.map(mapCarouselSlideRow);
}

export async function updateCarouselRun(
  id: string,
  updates: Partial<CreateCarouselRunInput>,
  poolInstance?: Pool
): Promise<CarouselRun> {
  const p = poolInstance || getPool();
  const setClauses: string[] = [];
  const params: unknown[] = [id];

  const allowedKeys: Array<keyof CreateCarouselRunInput> = [
    "job_id",
    "account_id",
    "account_role",
    "archetype_title",
    "bait_body",
    "tema",
    "legenda",
    "status",
    "output_dir",
    "error_message",
    "generated_at",
  ];

  for (const key of allowedKeys) {
    if (updates[key] !== undefined) {
      params.push(updates[key]);
      setClauses.push(`${key} = $${params.length}`);
    }
  }

  setClauses.push(`updated_at = NOW()`);

  const query = `
    UPDATE carousel_runs
    SET ${setClauses.join(", ")}
    WHERE id = $1
    RETURNING id, job_id, account_id, account_role, archetype_title, bait_body, tema,
              legenda, status, output_dir, error_message, generated_at, created_at, updated_at
  `;

  const result = await p.query(query, params);
  if (!result.rows[0]) {
    throw new AppError(`CarouselRun not found: ${id}`, 404, "not_found");
  }

  return mapCarouselRunRow(result.rows[0]);
}

export async function listCarouselRuns(
  filters: ListCarouselRunsFilters = {},
  poolInstance?: Pool
): Promise<CarouselRun[]> {
  const p = poolInstance || getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.accountId) {
    params.push(filters.accountId);
    conditions.push(`account_id = $${params.length}`);
  }
  if (filters.jobId) {
    params.push(filters.jobId);
    conditions.push(`job_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = filters.limit ? `LIMIT ${Number(filters.limit)}` : "";
  const offsetClause = filters.offset ? `OFFSET ${Number(filters.offset)}` : "";

  const query = `
    SELECT id, job_id, account_id, account_role, archetype_title, bait_body, tema,
           legenda, status, output_dir, error_message, generated_at, created_at, updated_at
    FROM carousel_runs
    ${whereClause}
    ORDER BY created_at DESC
    ${limitClause} ${offsetClause}
  `;

  const result = await p.query(query, params);
  return result.rows.map(mapCarouselRunRow);
}

export async function deleteCarouselRun(
  id: string,
  poolInstance?: Pool
): Promise<boolean> {
  const p = poolInstance || getPool();
  const result = await p.query("DELETE FROM carousel_runs WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}
