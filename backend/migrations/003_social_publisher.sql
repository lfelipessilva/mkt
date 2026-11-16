-- Alter accounts for social provider integration
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS social_provider TEXT,
  ADD COLUMN IF NOT EXISTS external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS social_account_metadata JSONB DEFAULT '{}'::jsonb;

-- Alter dispatch_channel enum to include 'buffer' and 'social'
ALTER TYPE dispatch_channel ADD VALUE IF NOT EXISTS 'buffer';
ALTER TYPE dispatch_channel ADD VALUE IF NOT EXISTS 'social';

-- Enhance tiktok_posts with provider tracking
ALTER TABLE tiktok_posts
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_post_id TEXT,
  ADD COLUMN IF NOT EXISTS publish_status TEXT DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_response JSONB;

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_external_id ON tiktok_posts(external_post_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_polling ON tiktok_posts(publish_status, last_polled_at);
