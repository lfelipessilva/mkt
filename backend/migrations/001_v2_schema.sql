-- Enums
CREATE TYPE account_role AS ENUM (
  'single_man',
  'single_woman',
  'couple_men',
  'couple_women'
);

CREATE TYPE content_scope AS ENUM (
  'shared',
  'single_man',
  'single_woman',
  'couple_men',
  'couple_women',
  'listo'
);

CREATE TYPE media_category AS ENUM ('cover', 'random', 'listo', 'capas', 'aleatorias');

CREATE TYPE run_status AS ENUM (
  'generating',
  'generated',
  'dispatching',
  'dispatched',
  'published',
  'failed'
);

CREATE TYPE tiktok_tracking_mode AS ENUM ('manual', 'api');

CREATE TYPE dispatch_channel AS ENUM ('api', 'telegram');
CREATE TYPE dispatch_status AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE job_status AS ENUM ('pending', 'running', 'completed', 'failed');

-- Accounts
CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  display_name    TEXT,
  persona         TEXT NOT NULL,
  role            account_role NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  tiktok_open_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Archetypes, baits, media_assets, media_usage
CREATE TABLE archetypes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           content_scope NOT NULL,
  title           TEXT NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, title)
);

CREATE TABLE baits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           content_scope NOT NULL,
  body            TEXT NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE media_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           content_scope NOT NULL,
  category        media_category NOT NULL,
  storage_path    TEXT NOT NULL UNIQUE,
  filename        TEXT NOT NULL,
  byte_size       BIGINT,
  width           INT,
  height          INT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE media_usage (
  media_id        UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  run_id          UUID NOT NULL,
  used_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, run_id)
);

-- Generation jobs, carousel runs, carousel slides
CREATE TABLE generation_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status          job_status NOT NULL DEFAULT 'pending',
  account_ids     TEXT[] NOT NULL,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE carousel_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID REFERENCES generation_jobs(id) ON DELETE SET NULL,
  account_id          TEXT NOT NULL REFERENCES accounts(id),
  account_role        account_role NOT NULL,
  archetype_title     TEXT NOT NULL,
  bait_body           TEXT,
  tema                TEXT,
  legenda             TEXT NOT NULL,
  status              run_status NOT NULL DEFAULT 'generating',
  output_dir          TEXT,
  error_message       TEXT,
  generated_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE carousel_slides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES carousel_runs(id) ON DELETE CASCADE,
  position        SMALLINT NOT NULL,
  storage_path    TEXT NOT NULL,
  media_id        UUID REFERENCES media_assets(id) ON DELETE SET NULL,
  UNIQUE (run_id, position)
);

ALTER TABLE media_usage
  ADD CONSTRAINT fk_media_usage_run
  FOREIGN KEY (run_id) REFERENCES carousel_runs(id) ON DELETE CASCADE;

-- Dispatch events
CREATE TABLE dispatch_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES carousel_runs(id) ON DELETE CASCADE,
  channel         dispatch_channel NOT NULL,
  status          dispatch_status NOT NULL DEFAULT 'pending',
  triggered_by    TEXT NOT NULL,
  request_payload JSONB,
  response_payload JSONB,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TikTok manual + API
CREATE TABLE tiktok_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL UNIQUE REFERENCES carousel_runs(id) ON DELETE CASCADE,
  tracking_mode   tiktok_tracking_mode NOT NULL DEFAULT 'manual',
  video_id        TEXT,
  video_url       TEXT,
  published_at    TIMESTAMPTZ,
  views           BIGINT NOT NULL DEFAULT 0,
  likes           BIGINT NOT NULL DEFAULT 0,
  comments        BIGINT NOT NULL DEFAULT 0,
  shares          BIGINT NOT NULL DEFAULT 0,
  metrics_note    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tiktok_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tiktok_post_id  UUID NOT NULL REFERENCES tiktok_posts(id) ON DELETE CASCADE,
  views           BIGINT NOT NULL DEFAULT 0,
  likes           BIGINT NOT NULL DEFAULT 0,
  comments        BIGINT NOT NULL DEFAULT 0,
  shares          BIGINT NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- App settings, TikTok sync runs
CREATE TABLE app_settings (
  key             TEXT PRIMARY KEY,
  value           JSONB NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tiktok_sync_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  posts_updated   INT NOT NULL DEFAULT 0,
  status          job_status NOT NULL,
  error_message   TEXT
);
