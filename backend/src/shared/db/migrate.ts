import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getPool, closePool } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(
  targetPool?: pg.Pool,
  customMigrationsDir?: string
): Promise<void> {
  const p = targetPool || getPool();
  const migrationsDir =
    customMigrationsDir || path.resolve(__dirname, '../../../migrations');

  const client = await p.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    const { rows: appliedRows } = await client.query<{ name: string }>(
      'SELECT name FROM _migrations'
    );
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    for (const sqlFile of sqlFiles) {
      if (appliedSet.has(sqlFile)) {
        continue;
      }

      const filePath = path.join(migrationsDir, sqlFile);
      const sql = await fs.readFile(filePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [
          sqlFile,
        ]);
        await client.query('COMMIT');
      } catch (migrationErr) {
        await client.query('ROLLBACK');
        throw migrationErr;
      }
    }
  } finally {
    client.release();
  }
}

// CLI entrypoint
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  (async () => {
    try {
      console.log('Running database migrations...');
      await runMigrations();
      console.log('Migrations applied successfully.');
      await closePool();
      process.exit(0);
    } catch (err) {
      console.error('Migration failed:', err);
      await closePool().catch(() => {});
      process.exit(1);
    }
  })();
}
