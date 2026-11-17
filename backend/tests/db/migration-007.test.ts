import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../../src/shared/db/migrate.js';

const { Pool } = pg;

describe('Migration 007: account_zernio_api_key', { timeout: 60000 }, () => {
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

  it('applies migration 007 and adds zernio_api_key column to accounts', async () => {
    await runMigrations(pool);

    const accountColsRes = await pool.query<{ column_name: string; data_type: string }>(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'accounts' AND column_name = 'zernio_api_key';
    `);
    assert.equal(accountColsRes.rows.length, 1, 'accounts should have zernio_api_key column');
    assert.equal(accountColsRes.rows[0].data_type, 'text');
  });
});
