# Silo-Only Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use worker-driven-development (`wdd boot`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Silo + Postgres are the only permanent media/carousel storage; `/tmp` only for generate/Telegram; remove local-disk and legacy naming (`capas`/`aleatorias`, MEDIA_ROOT volumes, disk scan).

**Architecture:** `media_assets` indexes Silo. Select reads DB. Upload/serve/delete hit Silo. Generate writes under `os.tmpdir()`, uploads to Silo, stores portable `output/...` paths. Dispatch downloads slides from Silo to temp before Telegram.

**Tech Stack:** Postgres, MinIO S3 (`@aws-sdk/client-s3`), Sharp, Fastify, Grammy

**Spec:** Approach A approved 2026-11-15 — Silo+DB permanent; temp local only for render/Telegram.

## Global Constraints

- Categories: `cover` | `random` | `listo` only
- Paths: `media/<scope>/<category>/<file>` or `media/listo/<file>`; carousels `output/<date>/<account>/post_NN/...`
- Production requires `isSiloEnabled()`; fail clearly if missing for media ops
- Tests: `TEST_DATABASE_URL` or testcontainers only — never prod `DATABASE_URL`
- **SPEED OVERRIDE (human):** skip RED/GREEN and all test runs on Tasks 1–5; implement + commit only. Run the full test suite only in Task 6.
- Skip cross-agent review on this run unless coordinator asks (speed).
- Do not commit unless the plan task says so; do not push
- Ponytail: smallest complete change; no drive-by refactors
- Implementer model preference: Antigravity `gemini-3.8-flash-medium` (no Grok available on this host)

## Review Focus

- Empty DB select / inactive assets
- Upload without Silo
- Telegram when slide only in Silo
- Docker without `./media` volume still generates

---

### Task 1: Canonical categories + Silo scan as sole indexer

**WDD class:** wiring  
**Files:**
- Modify: `backend/src/domain/media/paths.ts`
- Modify: `backend/src/domain/media/store.ts` (remove `scanMediaToDb`; keep `scanSiloMediaToDb`)
- Modify: `backend/src/index.ts`
- Modify: `backend/scripts/scan-media.ts`
- Modify: `backend/tests/media/paths.test.ts`
- Delete if present: local-only scan call sites

- [ ] **Step 1: RED** — Update `paths.test.ts`: `MEDIA_CATEGORIES` is only cover/random/listo; `CATEGORIES_BY_SCOPE` has no capas/aleatorias; `parseSiloMediaKey` still maps legacy silo folder names → canonical storage_path
- [ ] **Step 2: GREEN** — Implement category cleanup; delete `scanMediaToDb`; `index.ts` + `scan-media.ts` only call `scanSiloMediaToDb` when Silo enabled
- [ ] **Step 3: Verify** — `npx tsx --test tests/media/paths.test.ts` passes
- [ ] **Step 4: Commit** — `git add` relevant files; commit `refactor(media): silo scan only, drop legacy categories`

---

### Task 2: Select carousels from media_assets DB

**WDD class:** dense  
**Depends on:** Task 1  
**Files:**
- Modify: `backend/src/pipeline/select.ts`
- Modify: `backend/src/domain/media/store.ts` (add `listActiveMediaImages(scopes, category)` helper if needed)
- Modify: `backend/tests/pipeline/select.test.ts`
- Modify callers: `selectCarousel` → async if required

- [ ] **Step 1: RED** — Rewrite select tests: seed DB assets (cover/random/listo), no tmp capas/aleatorias dirs; `resolveMediaForRole` / `listImages(dir)` disk APIs removed or unused
- [ ] **Step 2: GREEN** — `selectCarousel` / `selectCarouselForAccount` load pools from `media_assets` (active). Slide `path` = `storage_path`. Rename `aleatoriasCount` → `randomCount` (or keep alias one release — prefer rename). Error messages use cover/random/listo
- [ ] **Step 3: Verify** — `npx tsx --test tests/pipeline/select.test.ts` passes
- [ ] **Step 4: Commit** — `refactor(select): pick media from media_assets`

---

### Task 3: Media HTTP routes Silo-only

**WDD class:** dense  
**Depends on:** Task 1  
**Files:**
- Modify: `backend/src/domain/media/routes.ts`
- Modify: `backend/src/domain/media/store.ts` (`deleteMediaAsset` Silo-only, no disk unlink)
- Modify: `backend/tests/media/routes.test.ts`

- [ ] **Step 1: RED** — Tests expect GET file / upload / delete without writing under MEDIA_ROOT; mock Silo or inject loaders
- [ ] **Step 2: GREEN** — GET `/file` streams from Silo only; POST upload buffer → Silo + upsert (require Silo); DELETE Silo + DB
- [ ] **Step 3: Verify** — `npx tsx --test tests/media/routes.test.ts` passes
- [ ] **Step 4: Commit** — `refactor(media): silo-only upload serve delete`

---

### Task 4: Generate + dispatch temp pipeline

**WDD class:** dense  
**Depends on:** Task 2, Task 3  
**Files:**
- Modify: `backend/src/domain/runs/generate.ts`
- Modify: `backend/src/domain/dispatch/service.ts`
- Modify: `backend/src/shared/storage/silo.ts` (ensure `downloadMediaFromSilo` / carousel download helpers)
- Modify: `backend/tests/runs/generate.test.ts`
- Modify: `backend/tests/dispatch/routes.test.ts` as needed

- [ ] **Step 1: RED** — Generate tests: seed DB media; inject `mediaBytesLoader` for render without real MinIO; assert portable `output/...` paths; no reliance on MEDIA_ROOT tree of capas/aleatorias
- [ ] **Step 2: GREEN** — Default outDir under `os.tmpdir()` (or OUTPUT_DIR if set for temp root); download source images via Silo (or injected loader); upload carousel to Silo (required when enabled); dispatch downloads carousel slides to temp before Telegram `InputFile`
- [ ] **Step 3: Verify** — `npx tsx --test tests/runs/generate.test.ts` and dispatch tests pass
- [ ] **Step 4: Commit** — `refactor(runs): temp render upload silo; dispatch downloads slides`

---

### Task 5: Strip legacy surface (scripts, docker, docs)

**WDD class:** scaffold  
**Depends on:** Task 4  
**Files:**
- Delete: `backend/scripts/migrate-media-dirs.ts`
- Modify: `backend/tests/media/paths.test.ts` (remove migrate-media-dirs tests)
- Modify: `Dockerfile`, `docker-compose.yml`, `README.md`, `.env.example`
- Grep-clean remaining required `MEDIA_ROOT` / `capas` / `aleatorias` in backend src (tests may mention only as negative)

- [ ] **Step 1:** Delete migrate-media-dirs + tests
- [ ] **Step 2:** Docker: drop `COPY media`, `MEDIA_ROOT` env, `./media` volume
- [ ] **Step 3:** README / `.env.example` Silo-only docs; `media:scan` = Silo→DB
- [ ] **Step 4: Verify** — `rg -n 'capas|aleatorias|migrate-media-dirs|MEDIA_ROOT' backend/src Dockerfile docker-compose.yml` shows nothing required (migrations SQL history OK)
- [ ] **Step 5: Commit** — `chore: remove local media legacy surface`

---

### Task 6: Full verify + prod Silo resync

**WDD class:** scaffold  
**Depends on:** Task 5  

- [ ] **Step 1:** `npm --prefix backend test` (or targeted suite) green
- [ ] **Step 2:** With prod `DATABASE_URL` + Silo env, `npm --prefix backend run media:scan` — expect ~143 active assets; accounts untouched
- [ ] **Step 3:** Report counts in `worker_done`
- [ ] **Step 4:** No commit unless fixes needed; if fixes, commit `fix: silo-only verify followups`
