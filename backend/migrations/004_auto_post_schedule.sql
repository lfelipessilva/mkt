-- 004_auto_post_schedule.sql
-- Auto Post Schedule + Buffer Publish migration

-- 1. Create auto_post_slots table
CREATE TABLE IF NOT EXISTS auto_post_slots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_date     DATE NOT NULL,
  window_id     TEXT NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('buffer', 'telegram', 'social')),
  scheduled_at  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'awaiting_approval', 'done', 'failed', 'skipped')),
  attempts      INT NOT NULL DEFAULT 0,
  run_id        UUID REFERENCES carousel_runs(id) ON DELETE SET NULL,
  last_error    TEXT,
  started_at    TIMESTAMPTZ,
  approved_at   TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_date, window_id, account_id)
);

-- 2. Account participates in auto routine?
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auto_post_enabled BOOLEAN NOT NULL DEFAULT true;

-- 3. Link run <-> slot (for approval and deep links)
ALTER TABLE carousel_runs ADD COLUMN IF NOT EXISTS auto_post_slot_id UUID REFERENCES auto_post_slots(id) ON DELETE SET NULL;

-- 4. Polling dedupe flag for tiktok_posts
ALTER TABLE tiktok_posts ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- 5. Indexes for slot queries
CREATE INDEX IF NOT EXISTS idx_auto_post_slots_due
  ON auto_post_slots (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_auto_post_slots_date
  ON auto_post_slots (slot_date, scheduled_at);
