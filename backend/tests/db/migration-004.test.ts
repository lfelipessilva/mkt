import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../../src/shared/db/migrate.js';

const { Pool } = pg;

describe('Migration 004: auto_post_schedule', { timeout: 60000 }, () => {
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

  it('creates auto_post_slots table, alters accounts, carousel_runs, and tiktok_posts, and creates indexes', async () => {
    await runMigrations(pool);

    // 1. Verify auto_post_slots table columns
    const slotsColsRes = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'auto_post_slots';
    `);
    const slotsCols = new Map(slotsColsRes.rows.map(r => [r.column_name, r]));
    assert.ok(slotsCols.has('id'), 'auto_post_slots should have id column');
    assert.ok(slotsCols.has('slot_date'), 'auto_post_slots should have slot_date column');
    assert.ok(slotsCols.has('window_id'), 'auto_post_slots should have window_id column');
    assert.ok(slotsCols.has('account_id'), 'auto_post_slots should have account_id column');
    assert.ok(slotsCols.has('channel'), 'auto_post_slots should have channel column');
    assert.ok(slotsCols.has('scheduled_at'), 'auto_post_slots should have scheduled_at column');
    assert.ok(slotsCols.has('window_end'), 'auto_post_slots should have window_end column');
    assert.ok(slotsCols.has('status'), 'auto_post_slots should have status column');
    assert.ok(slotsCols.has('attempts'), 'auto_post_slots should have attempts column');
    assert.ok(slotsCols.has('run_id'), 'auto_post_slots should have run_id column');
    assert.ok(slotsCols.has('last_error'), 'auto_post_slots should have last_error column');
    assert.ok(slotsCols.has('started_at'), 'auto_post_slots should have started_at column');
    assert.ok(slotsCols.has('approved_at'), 'auto_post_slots should have approved_at column');
    assert.ok(slotsCols.has('finished_at'), 'auto_post_slots should have finished_at column');
    assert.ok(slotsCols.has('created_at'), 'auto_post_slots should have created_at column');
    assert.ok(slotsCols.has('updated_at'), 'auto_post_slots should have updated_at column');

    // 2. Verify accounts has auto_post_enabled
    const accountColsRes = await pool.query<{ column_name: string; column_default: string }>(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_name = 'accounts' AND column_name = 'auto_post_enabled';
    `);
    assert.equal(accountColsRes.rows.length, 1, 'accounts should have auto_post_enabled column');

    // 3. Verify carousel_runs has auto_post_slot_id
    const runColsRes = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'carousel_runs' AND column_name = 'auto_post_slot_id';
    `);
    assert.equal(runColsRes.rows.length, 1, 'carousel_runs should have auto_post_slot_id column');

    // 4. Verify tiktok_posts has notified_at
    const postColsRes = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'tiktok_posts' AND column_name = 'notified_at';
    `);
    assert.equal(postColsRes.rows.length, 1, 'tiktok_posts should have notified_at column');

    // 5. Verify indexes on auto_post_slots
    const indexRes = await pool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'auto_post_slots';
    `);
    const indices = new Set(indexRes.rows.map(r => r.indexname));
    assert.ok(indices.has('idx_auto_post_slots_due'), 'idx_auto_post_slots_due should exist');
    assert.ok(indices.has('idx_auto_post_slots_date'), 'idx_auto_post_slots_date should exist');

    // 6. Verify unique constraint on (slot_date, window_id, account_id)
    const constraintRes = await pool.query<{ conname: string }>(`
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'auto_post_slots' AND c.contype = 'u';
    `);
    assert.ok(constraintRes.rows.length > 0, 'auto_post_slots should have unique constraint');
  });
});
