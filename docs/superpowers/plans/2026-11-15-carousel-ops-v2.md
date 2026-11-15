# Carousel ops v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postgres-backed carousel ops with a VPS-deployed React UI: role/shared content libraries, one carousel per account per job, manual TikTok metrics, dispatch API + Telegram Send, while keeping the existing Gemini/Sharp/Telegram pipeline.

**Architecture:** Split `backend/` (Fastify 5, TypeScript, `pg`, pipeline ported from `src/pipeline`) and `frontend/` (Vite + React). Single process serves API + static UI in production. JSON config and `data/usage.json` retired after migration CLI. Media on disk at `media/{shared|single_man|single_woman|couple_men|couple_women}/{capas,aleatorias,listo}`.

**Tech Stack:** Node ≥20, Fastify 5, `pg`, Zod, existing `@google/generative-ai`, `sharp`, `grammy`, Vite 6, React 19, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-15-carousel-ops-v2-design.md`

## Global Constraints

- Account roles exactly: `single_man` | `single_woman` | `couple_men` | `couple_women`
- Content scope exactly: `shared` + those four roles; never account-scoped libraries
- One carousel per account per generation; no `posts_per_run`
- Archetype merge: shared ∪ role, **dedupe by title, role wins**
- Bait merge: shared ∪ role, **dedupe by normalized body, role wins**
- TikTok v1: `tracking_mode = manual` on `tiktok_posts`; metrics edited on that row
- Manual **Send** always available via `dispatch_events`
- No vídeos/áudios in v2

## Review Focus

| Risk | Owning task | Test pins |
|------|-------------|-----------|
| Empty archetype pool after JSON→role migration | Task 14 | Seed script produces ≥1 archetype per role used by accounts |
| Dedupe drops wrong duplicate | Task 8 | `mergeArchetypes(shared, role)` role title wins |
| Generate uses wrong media tree (old `mulher/`) | Task 10 + Task 9 | `resolveMediaPaths(role)` returns scoped dirs only |
| Path traversal on media download | Task 11 | `GET /api/v1/media/file` rejects `../` |
| Cron generates disabled accounts | Task 13 | `generateBatch` filters `enabled = true` only |
| Manual TikTok metrics overwritten by sync | Task 16 | Sync skips `tracking_mode = manual` rows |

---

## File map (target)

| Path | Responsibility |
|------|----------------|
| `package.json` | Root scripts: `dev`, `build`, `test`, `db:migrate`, `db:seed` |
| `backend/migrations/001_v2_schema.sql` | Full schema from spec |
| `backend/src/shared/db/client.ts` | `pool`, `query`, transaction helper |
| `backend/src/shared/db/migrate.ts` | Run migrations in order |
| `backend/src/shared/errors.ts` | `AppError` |
| `backend/src/platform/auth.ts` | Bearer token gate |
| `backend/src/domain/content/effective.ts` | `mergeArchetypes`, `mergeBaits`, `scopesForRole` |
| `backend/src/domain/accounts/store.ts` | CRUD `accounts` |
| `backend/src/domain/accounts/routes.ts` | `/api/v1/accounts` |
| `backend/src/domain/archetypes/store.ts` | CRUD by `scope` |
| `backend/src/domain/baits/store.ts` | CRUD by `scope` |
| `backend/src/domain/media/paths.ts` | Disk layout ↔ `content_scope` |
| `backend/src/domain/media/store.ts` | `media_assets`, scan, usage |
| `backend/src/domain/media/routes.ts` | List, upload, delete, authenticated file |
| `backend/src/domain/runs/store.ts` | jobs, runs, slides |
| `backend/src/domain/runs/generate.ts` | `generateBatch`, wraps pipeline |
| `backend/src/domain/runs/routes.ts` | list, generate, get run |
| `backend/src/domain/dispatch/service.ts` | API + Telegram send |
| `backend/src/domain/dispatch/routes.ts` | POST send |
| `backend/src/domain/tiktok/store.ts` | Manual publish + metrics |
| `backend/src/domain/tiktok/routes.ts` | CRUD manual post, list for Desempenho |
| `backend/src/pipeline/*` | Ported `select`, `render`, `gemini`, `telegram` |
| `backend/src/app.ts` | Register plugins + routes |
| `backend/src/index.ts` | HTTP + optional bot/cron |
| `backend/scripts/seed-from-legacy.ts` | JSON + filesystem → DB |
| `backend/scripts/migrate-media-dirs.ts` | `mulher`→`single_woman`, etc. |
| `backend/tests/**` | `node:test` + Fastify inject |
| `frontend/src/App.tsx` | Shell, context switcher, routes |
| `frontend/src/api.ts` | Typed client |
| `frontend/src/tabs/**` | Desempenho, Galeria, Gerar, settings |
| `Dockerfile` | Multi-stage backend+frontend |
| `docker-compose.yml` | `DATABASE_URL`, media volume |

Legacy `src/`, `config/*.json` removed or shimmed only until Task 14 passes; delete in Task 20.

---

### Task 1: Monorepo scaffold

**WDD class:** scaffold

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/index.html`
- Modify: root `package.json`
- Test: (none)

**Interfaces:**
- Produces: `npm run dev:backend`, `npm run dev:frontend`, `npm run build`

- [x] **Step 1:** Add root orchestrator scripts mirroring prior `listo-marketing-ops-root` pattern (`dev:backend`, `dev:frontend`, `build`, `test`).
- [x] **Step 2:** `backend/` TypeScript ESM, `"type": "module"`, entry `backend/src/index.ts` with stub `GET /health`.
- [x] **Step 3:** `frontend/` Vite React TS; proxy `/api` → backend port.
- [x] **Step 4:** Run `npm run dev:backend` and `curl localhost:PORT/health` → `{ ok: true }`.
- [x] **Step 5:** Commit `chore: monorepo scaffold for carousel ops v2`.

---

### Task 2: Database schema migration

**WDD class:** dense

**Files:**
- Create: `backend/migrations/001_v2_schema.sql`
- Create: `backend/src/shared/db/client.ts`
- Create: `backend/src/shared/db/migrate.ts`
- Test: `backend/tests/db/migrate.test.ts`

**Interfaces:**
- Produces: `runMigrations(pool): Promise<void>`
- Consumes: `DATABASE_URL` env

- [x] **Step 1: Write failing test** — with Testcontainers or `DATABASE_URL` test DB, `runMigrations` creates `accounts` table.

```ts
// migrate.test.ts — assert to_regclass('public.accounts') is not null after migrate
```

- [x] **Step 2:** Run test → FAIL (no migrate).
- [x] **Step 3:** Paste schema from spec into `001_v2_schema.sql` (all enums + tables + FK on `media_usage.run_id`).
- [x] **Step 4:** Implement `migrate.ts` (ordered `.sql` files, idempotent `IF NOT EXISTS` only where spec already uses it).
- [x] **Step 5:** Test PASS; add `npm run db:migrate`.
- [x] **Step 6:** Commit `feat(db): v2 schema migration`.

---

### Task 3: Auth + Fastify app shell

**WDD class:** wiring

**Files:**
- Create: `backend/src/platform/auth.ts`, `backend/src/shared/errors.ts`, `backend/src/app.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/tests/platform/auth.test.ts`

**Interfaces:**
- Produces: `buildApp(): FastifyInstance` with `preHandler` auth on `/api/v1/*`
- Consumes: `API_TOKEN` env (same pattern as prior dashboard)

- [x] **Step 1:** Test `GET /api/v1/ping` without header → 401; with `Authorization: Bearer $API_TOKEN` → 200.
- [x] **Step 2:** Implement bearer check; public routes: `/health`, static assets.
- [x] **Step 3:** Commit `feat(api): bearer auth shell`.

---

### Task 4: Accounts API

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/accounts/store.ts`, `backend/src/domain/accounts/schemas.ts`, `backend/src/domain/accounts/routes.ts`
- Test: `backend/tests/accounts/routes.test.ts`

**Interfaces:**
- Produces:
  - `listAccounts(): Promise<Account[]>`
  - `upsertAccount(input): Promise<Account>`
  - `deleteAccount(id): Promise<void>`
  - Routes: `GET/POST/PATCH/DELETE /api/v1/accounts`

- [x] **Step 1:** Test list empty → `[]`; POST with `role: 'single_woman'` → 201; invalid role → 400.
- [x] **Step 2:** Zod schema: `id`, `persona`, `role`, `enabled`, optional `display_name`, `tiktok_open_id`.
- [x] **Step 3:** Implement store + routes; register in `app.ts`.
- [x] **Step 4:** Tests PASS.
- [x] **Step 5:** Commit `feat(accounts): crud api`.

---

### Task 5: Archetypes + baits API (by scope)

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/archetypes/store.ts`, `routes.ts`, `schemas.ts`
- Create: `backend/src/domain/baits/store.ts`, `routes.ts`, `schemas.ts`
- Test: `backend/tests/content/scoped-crud.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/v1/archetypes?scope=shared`
  - `PUT /api/v1/archetypes` body `{ scope, items: { title, sort_order, active }[] }` (replace list for scope)
  - Same pattern for `/api/v1/baits`

- [x] **Step 1:** Test PUT archetypes for `couple_men` then GET returns ordered titles.
- [x] **Step 2:** Enforce `UNIQUE(scope, title)` on upsert (update in place).
- [x] **Step 3:** Implement both resources.
- [x] **Step 4:** Commit `feat(content): archetypes and baits by scope`.

---

### Task 6: Effective content merge (dedupe)

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/content/effective.ts`
- Test: `backend/tests/content/effective.test.ts`

**Interfaces:**
- Produces:
  - `mergeArchetypes(sharedRows, roleRows): Archetype[]` — dedupe by title, **role wins**
  - `mergeBaits(sharedRows, roleRows): Bait[]` — dedupe by `body.trim().toLowerCase()`, role wins
  - `loadEffectiveForAccount(accountId): Promise<{ archetypes, baits, role }>` — loads from DB

- [x] **Step 1:** Test duplicate title in shared and role → single row, source role.
- [x] **Step 2:** Test duplicate bait body with different casing → one row.
- [x] **Step 3:** Implement pure functions + DB loader.
- [x] **Step 4:** Commit `feat(content): shared union role dedupe`.

---

### Task 7: Media directory layout

**WDD class:** wiring

**Files:**
- Create: `backend/scripts/migrate-media-dirs.ts`
- Modify: `README.md` media paths
- Test: `backend/tests/media/paths.test.ts`

**Interfaces:**
- Produces: `scopeToDir(scope: ContentScope): string` → `media/single_woman`, `media/shared`, etc.

- [ ] **Step 1:** Test `scopeToDir('shared')` → `media/shared`; categories `capas|aleatorias|listo`.
- [ ] **Step 2:** Script moves `media/mulher` → `media/single_woman`, `homem` → `single_man`, `casal` → split manually或 default `couple_women` (log ambiguous paths for operator).
- [ ] **Step 3:** Run script on repo `media/` tree.
- [ ] **Step 4:** Commit `chore(media): role-based directories`.

---

### Task 8: Media assets DB + API

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/media/paths.ts`, `store.ts`, `routes.ts`, `schemas.ts`
- Test: `backend/tests/media/routes.test.ts`

**Interfaces:**
- Produces:
  - `scanMediaToDb(mediaRoot): Promise<number>` — upsert `media_assets` from disk
  - `GET /api/v1/media?scope=&category=`
  - `POST /api/v1/media/upload` multipart
  - `DELETE /api/v1/media` body `{ storage_path }`
  - `GET /api/v1/media/file?path=` authenticated, traversal-safe

- [ ] **Step 1:** Test file endpoint rejects `../../etc/passwd`.
- [ ] **Step 2:** Implement scan on startup (dev) + manual `npm run media:scan`.
- [ ] **Step 3:** Upload writes under `scopeToDir(scope)/category/`.
- [ ] **Step 4:** Commit `feat(media): assets api and scan`.

---

### Task 9: Port pipeline to backend

**WDD class:** dense

**Files:**
- Create: `backend/src/pipeline/select.ts`, `render.ts`, `gemini.ts`, `telegram.ts` (port from `src/pipeline/*.js`)
- Modify: selection to use `account_role` + `loadEffectiveForAccount` + `media_assets` paths
- Test: `backend/tests/pipeline/select.test.ts`

**Interfaces:**
- Produces:
  - `selectCarousel(input: { role, archetypes, baits, mediaRoot, usage, usageDays }): Selection`
- Consumes: Task 6 merge output; Task 7 paths

- [x] **Step 1:** Port existing `select.js` tests behavior: capas from role only, aleatorias role∪shared, listo shared only.
- [x] **Step 2:** Replace `mediaRole` string with `account_role` enum values.
- [x] **Step 3:** Remove `archetypesByAccount[accountId]` — use merged lists.
- [x] **Step 4:** Commit `feat(pipeline): port selection to role scopes`.

---

### Task 10: Usage in Postgres

**WDD class:** dense

**Files:**
- Modify: `backend/src/domain/media/store.ts`
- Modify: `backend/src/pipeline/select.ts`
- Test: `backend/tests/media/usage.test.ts`

**Interfaces:**
- Produces:
  - `recordMediaUsage(runId, mediaIds[]): Promise<void>`
  - `recentlyUsedFilenames(role, days): Promise<Set<string>>` replacing `loadUsage` JSON

- [x] **Step 1:** Test after record, filename excluded from `available()` pool within window.
- [x] **Step 2:** Wire `usageDays = 7` from env default.
- [x] **Step 3:** Commit `feat(media): pg-backed usage rotation`.

---

### Task 11: Persist runs + slides on generate

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/runs/store.ts`, `generate.ts`, `schemas.ts`
- Modify: `backend/src/pipeline/run` logic (new `backend/src/domain/runs/generate.ts`)
- Test: `backend/tests/runs/generate.test.ts`

**Interfaces:**
- Produces:
  - `generateOneCarousel({ accountId, jobId?, mockCopy?, skipRender? }): Promise<CarouselRun>`
  - Inserts `carousel_runs`, `carousel_slides`, `media_usage`; writes files under `output/`

- [x] **Step 1:** Test with `skipRender: true`, `mockCopy` → DB rows `status = generated`, slides count ≥ 1.
- [x] **Step 2:** Port `render` + `gemini` from legacy `run.js`; drop `postsPerRun` loops (single iteration).
- [x] **Step 3:** Commit `feat(runs): persist carousel generation`.

---

### Task 12: Generation jobs API

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/runs/routes.ts`
- Test: `backend/tests/runs/routes.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/carousels/generate` body `{ accountIds?: string[] }` — omit = all enabled; exactly **1 run per account**
  - `GET /api/v1/carousels/runs?accountId=&limit=&offset=`
  - `GET /api/v1/carousels/runs/:id` with slides

- [x] **Step 1:** Test unknown `accountId` → 404; multi-id creates one job + N runs.
- [x] **Step 2:** Return job progress fields for UI polling.
- [x] **Step 3:** Commit `feat(api): batch carousel generate`.

---

### Task 13: Cron, bot, auto-dispatch hooks

**WDD class:** wiring

**Files:**
- Create: `backend/src/bot.ts`, `backend/src/cron.ts`, `backend/src/jobLock.ts` (port from `src/`)
- Modify: `backend/src/index.ts`
- Test: `backend/tests/runs/cron-filter.test.ts`

**Interfaces:**
- Produces: Telegram `/gerar`, `/mais`, `/status` calling `generateBatch`
- Consumes: `generateBatch` from Task 12

- [x] **Step 1:** Test `generateBatch({})` only includes `enabled` accounts.
- [x] **Step 2:** Wire cron schedule; respect `app_settings` key `auto_dispatch_enabled` (default false until Integrações UI).
- [x] **Step 3:** Commit `feat(ops): telegram bot and cron on new api`.

---

### Task 14: Legacy seed CLI

**WDD class:** dense

**Files:**
- Create: `backend/scripts/seed-from-legacy.ts`
- Test: `backend/tests/scripts/seed.test.ts` (fixture JSON)

**Interfaces:**
- Produces: `npm run db:seed` reads `config/*.json` if present

**Mapping (exact):**
- `rebeca.andrade.daily` → `single_woman`
- `lucas.mendes.rotina` → `single_man`
- `renata.sousa.daily`, `camila.e.thiago.ap` → `couple_women`
- Archetypes: merge all account lists that share a role into that role scope; dedupe titles; keep `shared` archetypes empty unless present in legacy
- Baits: `scope = shared`
- `disabledAccounts` → `enabled: false`

- [x] **Step 1:** Test seed creates 4 accounts and archetypes for each role used.
- [x] **Step 2:** Run `db:migrate` + `db:seed` against dev DB.
- [x] **Step 3:** Commit `feat(db): seed from legacy json`.

---

### Task 15: Dispatch (Send button)

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/dispatch/service.ts`, `routes.ts`
- Test: `backend/tests/dispatch/routes.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/carousels/runs/:id/send` query `channel=api|telegram`
  - `dispatch_events` rows; updates run status `dispatched` on success

- [x] **Step 1:** Test telegram send mocked → event `sent`, run status updated.
- [x] **Step 2:** API channel POSTs to `DISPATCH_WEBHOOK_URL` with slide paths + legenda JSON.
- [x] **Step 3:** Commit `feat(dispatch): manual send api and telegram`.

---

### Task 16: TikTok manual publish + Desempenho query

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/tiktok/store.ts`, `routes.ts`
- Test: `backend/tests/tiktok/manual.test.ts`

**Interfaces:**
- Produces:
  - `PUT /api/v1/tiktok/posts/:runId` upsert manual metrics (`video_url`, counts, `published_at`)
  - `GET /api/v1/tiktok/performance?accountId=&sort=views` — joins runs + `tiktok_posts`; manual fields from row
  - Stub `POST /api/v1/tiktok/sync` no-op except skips `tracking_mode = manual`

- [x] **Step 1:** Test manual upsert then performance list sorts by `views`.
- [x] **Step 2:** Mark run `status = published` when manual publish saved (optional `published_at` set).
- [x] **Step 3:** Commit `feat(tiktok): manual publish and performance list`.

---

### Task 17: Frontend shell (auth, sidebar, account context)

**WDD class:** scaffold

**Files:**
- Create: `frontend/src/App.tsx`, `components/Sidebar.tsx`, `components/LoginGate.tsx`, `api.ts`, `types.ts`, `index.css`
- Test: `frontend/src/context.test.ts` (optional pure reducer test)

**Interfaces:**
- Consumes: Task 3 auth token storage
- Produces: `AccountContext` state: `all | accountId`

- [x] **Step 1:** Login gate stores bearer token; sidebar leaves match spec nav.
- [x] **Step 2:** Context switcher lists accounts from `GET /accounts`.
- [x] **Step 3:** Commit `feat(ui): shell and account context`.

---

### Task 18: Config pages (Contas, Textos, Mídias)

**WDD class:** dense

**Files:**
- Create: `frontend/src/tabs/settings/AccountsPage.tsx`, `TextsPage.tsx`, `MediaPage.tsx`, `components/AuthImage.tsx`

- [x] **Step 1:** Accounts CRUD forms with role select (4 enums).
- [x] **Step 2:** Texts page: scope tabs `shared` + 4 roles; edit archetypes + baits lists.
- [x] **Step 3:** Media grid by scope/category; upload/delete; thumbnails via `/api/v1/media/file`.
- [x] **Step 4:** Pinned account opens role scope by default.
- [x] **Step 5:** Commit `feat(ui): configuration pages`.

---

### Task 19: Gerar page

**WDD class:** wiring

**Files:**
- Create: `frontend/src/tabs/GeneratePage.tsx`

- [ ] **Step 1:** Modes: all enabled | checkbox accounts; show count = selected accounts.
- [ ] **Step 2:** Poll job/run status; toast on complete.
- [ ] **Step 3:** Commit `feat(ui): generate console`.

---

### Task 20: Galeria + Desempenho

**WDD class:** dense

**Files:**
- Create: `frontend/src/tabs/GalleryPage.tsx`, `PerformancePage.tsx`, `components/RunCard.tsx`, `ManualTikTokModal.tsx`

- [ ] **Step 1:** Gallery filmstrip per run; **Send** calls Task 15.
- [ ] **Step 2:** Desempenho table from Task 16; sort by views; account filter respects context.
- [ ] **Step 3:** Modal **Marcar como publicado manualmente** → PUT tiktok post.
- [ ] **Step 4:** Commit `feat(ui): gallery performance manual tiktok`.

---

### Task 21: Integrações page + static production serve

**WDD class:** wiring

**Files:**
- Create: `frontend/src/tabs/IntegrationsPage.tsx`
- Modify: `backend/src/app.ts` serve `frontend/dist`
- Modify: `Dockerfile`, `docker-compose.yml`

- [ ] **Step 1:** UI toggles `app_settings` keys (`auto_dispatch_enabled`); test dispatch button.
- [ ] **Step 2:** TikTok sync button calls stub; shows last sync row if any.
- [ ] **Step 3:** `npm run build` + Docker smoke: health + login + one API call.
- [ ] **Step 4:** Commit `feat(deploy): integrations page and docker`.

---

### Task 22: Remove legacy entrypoints

**WDD class:** wiring

**Files:**
- Delete: `src/index.js`, `src/config.js`, `config/*.json` usage from runtime path
- Modify: `README.md`, `ecosystem.config.cjs` → point to `backend/dist/index.js`

- [ ] **Step 1:** `npm test` + `npm run build` green.
- [ ] **Step 2:** Document VPS env vars in README.
- [ ] **Step 3:** Commit `chore: remove legacy json config runtime`.

---

## Suggested execution order

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 14 → 13 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22
```

(Task 14 before 13 so cron has seeded data in dev; Task 7 can run in parallel with 5–6 if needed.)

## Self-review (spec coverage)

| Spec section | Task(s) |
|--------------|---------|
| Accounts + 4 roles | 4, 14, 18 |
| Shared/role content | 5, 6, 18 |
| Dedupe | 6 |
| Media by scope | 7, 8, 18 |
| One carousel / generate pick | 11, 12, 19 |
| Galeria / Desempenho | 20 |
| Manual TikTok | 16, 20 |
| Send + auto dispatch | 15, 21 |
| Context switcher | 17, 18–20 |
| VPS deploy | 21 |

Gaps intentionally deferred: full TikTok API sync (stub only), engagement % vs account avg (UI can show raw metrics first; add SQL view later).