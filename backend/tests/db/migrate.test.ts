import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../../src/shared/db/migrate.js';

const { Pool } = pg;

describe('Database migrations', { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;

  before(async () => {
    let connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      connectionString = container.getConnectionUri();
    }

    pool = new Pool({ connectionString });
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  it('runs migrations and creates accounts and all v2 tables', async () => {
    await runMigrations(pool);

    const expectedTables = [
      'accounts',
      'archetypes',
      'baits',
      'media_assets',
      'media_usage',
      'generation_jobs',
      'carousel_runs',
      'carousel_slides',
      'dispatch_events',
      'tiktok_posts',
      'tiktok_metrics',
      'app_settings',
      'tiktok_sync_runs',
    ];

    for (const table of expectedTables) {
      const res = await pool.query(
        `SELECT to_regclass('public.${table}') as tbl;`
      );
      assert.ok(res.rows[0].tbl, `Table public.${table} should exist`);
    }

    // Verify foreign key on media_usage.run_id
    const fkRes = await pool.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conname = 'fk_media_usage_run';
    `);
    assert.equal(
      fkRes.rows.length,
      1,
      'Foreign key fk_media_usage_run should exist on media_usage'
    );

    // Verify enums
    const expectedEnums = [
      'account_role',
      'content_scope',
      'media_category',
      'run_status',
      'tiktok_tracking_mode',
      'dispatch_channel',
      'dispatch_status',
      'job_status',
    ];

    for (const enumName of expectedEnums) {
      const enumRes = await pool.query(
        `SELECT typname FROM pg_type WHERE typname = $1;`,
        [enumName]
      );
      assert.equal(
        enumRes.rows.length,
        1,
        `Enum type ${enumName} should exist`
      );
    }
  });

  it('is idempotent when run multiple times', async () => {
    await runMigrations(pool);
    await runMigrations(pool);

    const res = await pool.query(
      "SELECT to_regclass('public.accounts') as accounts_tbl;"
    );
    assert.ok(
      res.rows[0].accounts_tbl,
      'public.accounts table should still exist after re-running migrations'
    );
  });
});
