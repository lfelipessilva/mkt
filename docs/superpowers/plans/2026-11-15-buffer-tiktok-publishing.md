# TikTok Publishing & Metrics (Buffer GraphQL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a provider-agnostic publishing and metrics layer for TikTok, integrating Buffer GraphQL API (Phase 1) for automated multi-image carousel and video posting, polling of pending posts, and daily metrics collection.

**Architecture:** The core system interacts exclusively with a `SocialPublisherProvider` interface. The `BufferPublisherAdapter` handles Buffer's GraphQL mutations (`createPost` with `assets` URLs from VPS Silo MinIO) and queries (`post` for status and metrics), with built-in guardrails (max 3 accounts, rate limits with backoff, queue limits with internal fallback, 30-day metrics window). Background cron jobs handle polling and daily metrics sync.

**Tech Stack:** TypeScript, Node.js, Fastify, PostgreSQL (`pg`), node-cron, Buffer GraphQL API, MinIO/S3 (`@aws-sdk/client-s3`), Node test runner (`tsx --test`).

**Spec:** `docs/superpowers/specs/2026-11-15-buffer-tiktok-publishing-design.md`

## Global Constraints

- Node >= 20, TypeScript 5.7+ with ESM imports (`.js` extension in imports).
- Database migration script executed via `npm --prefix backend run db:migrate`.
- Tests run with `NODE_ENV=test tsx --test --test-concurrency=1 "tests/**/*.test.ts"`.
- Rate limit: 100 requests per 15 minutes to Buffer API with exponential backoff on HTTP 429.
- Maximum 3 active accounts under `buffer` provider (Free tier constraint).
- Metrics collection window strictly capped at posts published within the last 30 days.

## Review Focus

1. **Missing or non-public Silo URL:** When `SILO_SERVER_URL` is unconfigured or a slide file is missing in Silo, `resolveCarouselSlidePublicUrls` must throw a descriptive `AppError` before any HTTP call is made to Buffer.
2. **Buffer HTTP 429 Rate Limit:** When Buffer responds with HTTP 429 or `MutationError` for rate limits, the adapter must retry with exponential backoff and not lose the dispatch event.
3. **Queue Limit Overflow (10 posts):** When 10 posts are already scheduled in Buffer and another scheduled post is requested, it must be stored as `publish_status = 'internal_pending'` in Postgres and dispatched when `scheduled_at <= now()`.
4. **Buffer GraphQL Error Payload:** When Buffer returns a 200 HTTP status with GraphQL errors or `MutationError`, the adapter must detect this, throw or return `status: 'failed'` with the exact error message, rather than assuming success.
5. **Account Linking Mismatch:** When an account is dispatched to Buffer without a configured `external_account_id` (Buffer channel ID), the dispatch service must fail with a helpful error prompting the user to sync or link accounts.

---

### Task 1: Database Migration for Social Publishing

**WDD class:** wiring

**Files:**
- Create: `backend/migrations/003_social_publisher.sql`
- Modify: `backend/src/shared/db/migrate.ts` (if migration runner requires manual registration)
- Test: `backend/tests/db/migration-003.test.ts`

**Interfaces:**
- Consumes: PostgreSQL connection from `backend/src/shared/db/client.ts`
- Produces: Updated schema with `accounts.social_provider`, `accounts.external_account_id`, `accounts.social_account_metadata`, `dispatch_channel` ('buffer', 'social'), and `tiktok_posts` columns (`provider`, `external_post_id`, `publish_status`, `scheduled_at`, `last_polled_at`, `raw_response`).

- [ ] **Step 1: Write migration file `003_social_publisher.sql`**

```sql
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
```

- [ ] **Step 2: Write test to verify migration applies cleanly**

Create `backend/tests/db/migration-003.test.ts` verifying that columns `social_provider`, `external_account_id`, `external_post_id`, `publish_status`, and `scheduled_at` exist after migration.

- [ ] **Step 3: Run migration test**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/db/migration-003.test.ts`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/003_social_publisher.sql backend/tests/db/migration-003.test.ts
git commit -m "feat(db): add migration 003 for social publisher columns and channels"
```

---

### Task 2: Social Publisher Domain Types & Factory

**WDD class:** wiring

**Files:**
- Create: `backend/src/domain/social/types.ts`
- Create: `backend/src/domain/social/factory.ts`
- Test: `backend/tests/social/factory.test.ts`

**Interfaces:**
- Consumes: None (pure domain types)
- Produces: `SocialPublisherProvider`, `PublishPostRequest`, `PublishPostResponse`, `SocialAccount`, `PostMetrics`, `getSocialPublisherProvider(name?: string)`

- [ ] **Step 1: Write failing test for provider factory**

Create `backend/tests/social/factory.test.ts` asserting:
1. `getSocialPublisherProvider('buffer')` returns an instance with `providerName === 'buffer'`.
2. Default provider resolves from `process.env.SOCIAL_PROVIDER || 'buffer'`.
3. Unsupported provider throws `AppError(..., 400, 'unsupported_provider')`.

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/factory.test.ts`  
Expected: FAIL (files missing)

- [ ] **Step 3: Implement `types.ts` and `factory.ts`**

Define domain interfaces in `backend/src/domain/social/types.ts` as specified in Section 4 of the design doc.
Implement `getSocialPublisherProvider` in `backend/src/domain/social/factory.ts` instantiating `BufferPublisherAdapter`.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/factory.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/social/types.ts backend/src/domain/social/factory.ts backend/tests/social/factory.test.ts
git commit -m "feat(social): add domain types and publisher provider factory"
```

---

### Task 3: Buffer GraphQL Adapter (`BufferPublisherAdapter`)

**WDD class:** wiring

**Files:**
- Create: `backend/src/domain/social/providers/buffer.ts`
- Test: `backend/tests/social/buffer.test.ts`

**Interfaces:**
- Consumes: `SocialPublisherProvider`, `PublishPostRequest`, `PublishPostResponse`, `SocialAccount`, `PostMetrics` from `types.ts`
- Produces: `BufferPublisherAdapter` implementing `SocialPublisherProvider` with GraphQL operations:
  - `listConnectedAccounts()`
  - `publishPost(request)`
  - `getPostStatus(externalPostId)`
  - `getPostMetrics(externalPostId)`

- [ ] **Step 1: Write unit tests covering Buffer GraphQL operations with mocked fetch**

Create `backend/tests/social/buffer.test.ts`:
- Test 1: `listConnectedAccounts()` filters channels where `service === 'tiktok'` and maps `channel.id` to `externalAccountId`.
- Test 2: `publishPost()` for carousel maps `imageUrls` into `assets: [{ image: { url } }]` and uses `mode: 'shareNow'` for immediate.
- Test 3: `publishPost()` for scheduled mode maps `mode: 'customScheduled'` with ISO timestamp `dueAt`.
- Test 4: `getPostStatus()` maps Buffer `status: 'sent'` to `'published'` and `status: 'failed'` to `'failed'`.
- Test 5: `getPostMetrics()` maps `metrics` list (`impressions` -> `views`, `reactions` -> `likes`, `comments`, `shares`).
- Test 6: Rate limit handling: returns retry or handles 429 with backoff.
- Test 7: 30-day window check: `getPostMetrics()` rejects posts older than 30 days.

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/buffer.test.ts`  
Expected: FAIL (`BufferPublisherAdapter` not defined)

- [ ] **Step 3: Implement `BufferPublisherAdapter` in `backend/src/domain/social/providers/buffer.ts`**

Implement GraphQL POST client to `BUFFER_API_URL` (default `https://api.buffer.com`) with `Authorization: Bearer ${token}`. Implement the 4 required methods, error parsing, and guardrails.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/buffer.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/social/providers/buffer.ts backend/tests/social/buffer.test.ts
git commit -m "feat(social): implement BufferPublisherAdapter with GraphQL support and guardrails"
```

---

### Task 4: Silo Public URL Resolver

**WDD class:** wiring

**Files:**
- Create: `backend/src/domain/social/urls.ts`
- Test: `backend/tests/social/urls.test.ts`

**Interfaces:**
- Consumes: `CarouselRun` from `backend/src/domain/runs/schemas.ts`, Silo config from `backend/src/shared/storage/silo.ts`
- Produces: `resolveCarouselSlidePublicUrls(run: CarouselRun): string[]`

- [ ] **Step 1: Write failing test for URL resolver**

Create `backend/tests/social/urls.test.ts`:
- Test: given a run with slides sorted by position (1, 2, 3), returns array of URLs:
  `https://personal-minio.adaygq.easypanel.host/carousels/{relOutDir}/slide_1.jpg`, etc.
- Test: throws `AppError('silo_not_configured', 400)` if `SILO_SERVER_URL` is absent.
- Test: throws `AppError('no_slides', 400)` if run has 0 slides.

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/urls.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement `resolveCarouselSlidePublicUrls` in `backend/src/domain/social/urls.ts`**

Read `SILO_SERVER_URL` and `SILO_CAROUSELS_BUCKET`, extract relative path from slide storage paths or run `output_dir`, and construct HTTPS URLs.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/urls.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/social/urls.ts backend/tests/social/urls.test.ts
git commit -m "feat(social): add Silo carousel slide public URL resolver"
```

---

### Task 5: Dispatch Service Integration with Social Publisher

**WDD class:** wiring

**Files:**
- Modify: `backend/src/domain/dispatch/schemas.ts`
- Modify: `backend/src/domain/dispatch/service.ts`
- Modify: `backend/src/domain/dispatch/routes.ts`
- Test: `backend/tests/dispatch/social-dispatch.test.ts`

**Interfaces:**
- Consumes: `dispatchCarouselRun`, `getSocialPublisherProvider`, `resolveCarouselSlidePublicUrls`, `getAccount`
- Produces: Automated dispatch to `channel: 'buffer' | 'social'`, recording of `dispatch_events`, and creation of `tiktok_posts` row with `tracking_mode = 'api'`, `provider = 'buffer'`, `external_post_id`, `publish_status`.

- [ ] **Step 1: Write failing test for buffer dispatch**

Create `backend/tests/dispatch/social-dispatch.test.ts`:
- Dispatch run with `channel = 'buffer'`.
- Verify account's `external_account_id` is passed to `publishPost`.
- Verify `dispatch_events` is recorded with `channel = 'buffer'` and `status = 'sent'`.
- Verify `tiktok_posts` row is created/updated with `provider = 'buffer'`, `external_post_id`, and `publish_status`.

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/dispatch/social-dispatch.test.ts`  
Expected: FAIL (unsupported dispatch channel 'buffer')

- [ ] **Step 3: Update `schemas.ts`, `service.ts`, and `routes.ts`**

Update `SendCarouselRunQuerySchema` to include `'buffer'` and `'social'`.
In `service.ts`, add the execution branch for `'buffer'` / `'social'`, resolving provider via `getSocialPublisherProvider()` and updating `tiktok_posts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/dispatch/social-dispatch.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/dispatch/schemas.ts backend/src/domain/dispatch/service.ts backend/src/domain/dispatch/routes.ts backend/tests/dispatch/social-dispatch.test.ts
git commit -m "feat(dispatch): integrate social publisher provider into dispatch service"
```

---

### Task 6: Polling Worker & Daily Metrics Sync Worker

**WDD class:** wiring

**Files:**
- Create: `backend/src/domain/social/polling.ts`
- Create: `backend/src/domain/social/metricsSync.ts`
- Modify: `backend/src/cron.ts`
- Test: `backend/tests/social/polling.test.ts`
- Test: `backend/tests/social/metricsSync.test.ts`

**Interfaces:**
- Consumes: `getPool`, `SocialPublisherProvider`
- Produces: `pollPendingPostsJob(pool, provider)` and `syncTikTokMetricsDailyJob(pool, provider)`

- [ ] **Step 1: Write tests for polling worker and metrics sync worker**

Create `backend/tests/social/polling.test.ts`:
- Post in status `'queued'` transitions to `'published'` when Buffer status returns `'published'`.
- Updates `carousel_runs.status = 'published'` and `tiktok_posts.published_at`.
- Handles `internal_pending` posts when `scheduled_at <= now()` by calling `publishPost(mode: 'shareNow')`.

Create `backend/tests/social/metricsSync.test.ts`:
- Iterates published posts < 30 days old with `external_post_id`.
- Calls `provider.getPostMetrics()`.
- Updates `tiktok_posts` views/likes/comments/shares and inserts record in `tiktok_metrics`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/polling.test.ts tests/social/metricsSync.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement `polling.ts` and `metricsSync.ts`**

Implement DB queries and provider calls. Register jobs in `backend/src/cron.ts` (polling runs every 2 minutes; metrics sync runs daily).

- [ ] **Step 4: Run tests to verify they pass**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/polling.test.ts tests/social/metricsSync.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/social/polling.ts backend/src/domain/social/metricsSync.ts backend/src/cron.ts backend/tests/social/polling.test.ts backend/tests/social/metricsSync.test.ts
git commit -m "feat(social): add polling worker and daily metrics sync job"
```

---

### Task 7: Social Accounts Sync Endpoint & Post for Me Phase 2 Stubs

**WDD class:** wiring

**Files:**
- Create: `backend/src/domain/social/routes.ts`
- Create: `backend/src/domain/social/providers/postforme.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/social/routes.test.ts`

**Interfaces:**
- Consumes: `app.register(socialRoutes, { prefix: '/social' })`
- Produces:
  - `POST /api/v1/social/accounts/sync`: pulls channels from Buffer and associates `external_account_id` to accounts by handle/persona.
  - `POST /api/v1/webhooks/social/postforme`: webhook listener for Phase 2 readiness.

- [ ] **Step 1: Write failing tests for social routes**

Create `backend/tests/social/routes.test.ts`:
- Tests `POST /api/v1/social/accounts/sync` returns synced accounts list.
- Tests `POST /api/v1/webhooks/social/postforme` acknowledges events.

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/routes.test.ts`  
Expected: FAIL (routes not registered)

- [ ] **Step 3: Implement `routes.ts`, `postforme.ts` stub, and register in `app.ts`**

Implement `socialRoutes` in `backend/src/domain/social/routes.ts` and register in `backend/src/app.ts` under `/api/v1/social`.

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test npm --prefix backend run test -- tests/social/routes.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/social/routes.ts backend/src/domain/social/providers/postforme.ts backend/src/app.ts backend/tests/social/routes.test.ts
git commit -m "feat(social): add accounts sync endpoint and Post for Me webhook stub"
```

---

### Task 8: Full End-to-End Verification & Documentation

**WDD class:** wiring

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Test: `backend/tests/social/e2e-buffer-flow.test.ts`

**Interfaces:**
- End-to-end integration proving:
  1. Carousel generation $\rightarrow$
  2. Slide upload to Silo $\rightarrow$
  3. Buffer dispatch $\rightarrow$
  4. Polling update $\rightarrow$
  5. Metrics sync $\rightarrow$
  6. TikTok performance ranking update.

- [ ] **Step 1: Write comprehensive e2e test `e2e-buffer-flow.test.ts`**

Create test exercising the full lifecycle from carousel run creation to Buffer dispatch, mock polling resolution to `published`, and metrics collection.

- [ ] **Step 2: Run all backend tests**

Run: `npm --prefix backend run test`  
Expected: All tests PASS with 0 failures.

- [ ] **Step 3: Document environment variables in `.env.example` and `README.md`**

Add `BUFFER_API_URL=https://api.buffer.com`, `BUFFER_ACCESS_TOKEN=`, `SOCIAL_PROVIDER=buffer` to `.env.example` and document the workflow in `README.md`.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example backend/tests/social/e2e-buffer-flow.test.ts
git commit -m "docs(social): complete Buffer TikTok integration documentation and e2e test"
```
