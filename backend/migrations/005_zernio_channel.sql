ALTER TYPE dispatch_channel ADD VALUE IF NOT EXISTS 'zernio';

ALTER TABLE auto_post_slots DROP CONSTRAINT IF EXISTS auto_post_slots_channel_check;

UPDATE auto_post_slots
SET status = 'skipped',
    last_error = 'buffer removido; sincronize a conta no Zernio',
    finished_at = COALESCE(finished_at, now()),
    updated_at = now()
WHERE channel = 'buffer'
  AND status IN ('pending', 'running', 'awaiting_approval');

UPDATE auto_post_slots
SET channel = 'zernio',
    updated_at = now()
WHERE channel = 'buffer';

ALTER TABLE auto_post_slots
  ADD CONSTRAINT auto_post_slots_channel_check
  CHECK (channel IN ('zernio', 'telegram', 'social'));
