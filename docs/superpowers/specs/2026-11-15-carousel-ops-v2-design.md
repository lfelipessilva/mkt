# Carousel ops v2 — UI + database design

## Intent

Rebuild marketing carousel ops from the **generate + Telegram** baseline: Postgres as source of truth, VPS-deployed UI, account-scoped workflows, role-based shared content libraries, TikTok performance tracking, auto-dispatch API, and manual **Send** / **manual publish** paths.

## Goals

- One carousel per account per generation (no `posts_per_run`).
- Accounts carry **role** only; archetypes, baits, and media are **shared** or **role-scoped**, never account-only.
- Global and **pinned account** context across Carrosséis screens.
- Generate **all active** or **pick accounts**.
- **Desempenho** ranked by metrics; **Galeria** slide-first.
- TikTok: API sync when linked; **manual publish** with editable metrics for now.
- Dedupe when merging shared + role pools (by title for archetypes, by body for baits).

## Non-goals

- Videos/audios domains (v1).
- Per-account archetype or media tables.
- Full TikTok OAuth UX (manual entry sufficient for v1).

## UX basics

### Shell

- Left sidebar + main content.
- **Context:** `Todas as contas` | pin one account (handle).
- **Generate** (header): todas ativas | escolher contas | só conta atual.

### Navigation

```
Carrosséis
  Desempenho
  Galeria
  Gerar
Configuração
  Contas
  Textos      — scope: shared | role
  Mídias      — scope: shared | role
  Integrações — auto-dispatch, TikTok sync, Telegram test
```

### Context

| Screen | Todas | Pinned account |
|--------|-------|----------------|
| Desempenho / Galeria | All runs | Filtered to account |
| Gerar | Multi-select | Default single account |
| Textos / Mídias | Scope tabs | Default account’s role + link to shared |

### Content resolution at generate

For account with role `R`:

- `archetypes_effective` = active shared ∪ active role(`R`), **dedupe by `title`** (role wins on conflict — builder call: keep role row).
- `baits_effective` = shared ∪ role(`R`), **dedupe by normalized `body`**.
- `media_effective` = shared ∪ role(`R`), categories `capas` | `aleatorias` | `listo`.

### Run lifecycle

```
generating → generated → [dispatch optional] → published
                ↓              ↓
              failed         failed
```

- **Send** button creates `dispatch_events` (API or Telegram).
- **Publicado manualmente** on TikTok creates/updates `tiktok_posts` with `tracking_mode = manual`; user edits URL and metrics in UI.

### Manual TikTok (v1)

- Action on Galeria/Desempenho: **Marcar como publicado manualmente**.
- Form: `video_url`, optional `video_id`, `published_at`, views, likes, comments, shares (all editable later).
- No sync job required while `tracking_mode = manual`.
- Switch to API later: set `tracking_mode = api` + `video_id` (migration path, not required v1).

### Roles (fixed set of 4)

Account `role` and content scope (except `shared`) use the same four values:

- `single_man`
- `single_woman`
- `couple_men`
- `couple_women`

## Database

### Enums

```sql
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
  'couple_women'
);

CREATE TYPE media_category AS ENUM ('capas', 'aleatorias', 'listo');

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
```

### accounts

```sql
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
```

### archetypes, baits, media_assets

```sql
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
```

### generation_jobs, carousel_runs, carousel_slides

```sql
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
```

### dispatch_events

```sql
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
```

### TikTok — manual + API

```sql
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
```

**Display rule:** if `tracking_mode = manual`, UI reads/writes `tiktok_posts` metric columns. If `api`, latest row in `tiktok_metrics` overrides display; sync job appends snapshots.

### app_settings, tiktok_sync_runs

```sql
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
```

## Legacy mapping

| Old | New |
|-----|-----|
| `mediaRole` mulher | `single_woman` |
| homem | `single_man` |
| casal (F-lead persona) | `couple_women` or `couple_men` (per persona) |
| per-account archetypes in JSON | merge into role scope + dedupe |

## Approved decisions

1. Shared ∪ role content with **dedupe** (title / body).
2. TikTok **manual** publish + editable metrics on `tiktok_posts`; API sync optional later.
3. Exactly **four** account roles (+ `shared` content scope only).

## Next step

Implementation plan after explicit approval of this document (`writing-plans` skill).