import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../../src/shared/db/migrate.js';

const { Pool } = pg;

describe('Migration 003: social_publisher', { timeout: 60000 }, () => {
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

  it('applies migration 003 and creates social publisher columns, channels, and indexes', async () => {
    await runMigrations(pool);

    // Verify accounts columns: social_provider, external_account_id, social_account_metadata
    const accountColsRes = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'accounts';
    `);
    const accountCols = new Set(accountColsRes.rows.map(r => r.column_name));
    assert.ok(accountCols.has('social_provider'), 'accounts should have social_provider column');
    assert.ok(accountCols.has('external_account_id'), 'accounts should have external_account_id column');
    assert.ok(accountCols.has('social_account_metadata'), 'accounts should have social_account_metadata column');

    // Verify dispatch_channel enum includes 'buffer' and 'social'
    const enumRes = await pool.query<{ enumlabel: string }>(`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'dispatch_channel';
    `);
    const enumValues = new Set(enumRes.rows.map(r => r.enumlabel));
    assert.ok(enumValues.has('buffer'), 'dispatch_channel enum should include buffer');
    assert.ok(enumValues.has('social'), 'dispatch_channel enum should include social');

    // Verify tiktok_posts columns: provider, external_post_id, publish_status, scheduled_at, last_polled_at, raw_response
    const postColsRes = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'tiktok_posts';
    `);
    const postCols = new Set(postColsRes.rows.map(r => r.column_name));
    assert.ok(postCols.has('provider'), 'tiktok_posts should have provider column');
    assert.ok(postCols.has('external_post_id'), 'tiktok_posts should have external_post_id column');
    assert.ok(postCols.has('publish_status'), 'tiktok_posts should have publish_status column');
    assert.ok(postCols.has('scheduled_at'), 'tiktok_posts should have scheduled_at column');
    assert.ok(postCols.has('last_polled_at'), 'tiktok_posts should have last_polled_at column');
    assert.ok(postCols.has('raw_response'), 'tiktok_posts should have raw_response column');

    // Verify indexes exist
    const indexRes = await pool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'tiktok_posts';
    `);
    const indices = new Set(indexRes.rows.map(r => r.indexname));
    assert.ok(indices.has('idx_tiktok_posts_external_id'), 'idx_tiktok_posts_external_id index should exist');
    assert.ok(indices.has('idx_tiktok_posts_polling'), 'idx_tiktok_posts_polling index should exist');
  });
});
