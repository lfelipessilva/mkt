# Zernio Tracking + Carrossel Único — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar cada carrossel em pasta única e fazer status, métricas e ID do Zernio aparecerem sozinhos, sem marcação manual.

**Architecture:** Backend passa a usar um ID único na pasta de geração, implementa `getPostMetrics` via `/v1/analytics`, sincroniza status publicado no dispatch/polling e expõe provider/ID/status nas APIs de runs e desempenho. Frontend usa esses campos para trocar o botão manual por "Publicado" e priorizar o Zernio.

**Tech Stack:** TypeScript, Fastify, Postgres, `@zernio/node`, React, Node test runner (`tsx --test`).

**Spec:** `docs/superpowers/specs/2026-11-16-zernio-tracking-carrossel-unico-design.md`

## Global Constraints

- Publicação sempre com faixa comercial; sem faixa, falha antes de criar o post.
- `publish_status = published` do Zernio deve refletir em `carousel_runs.status = published`.
- Métricas incompletas (`syncStatus = pending/unavailable`, sem `analytics`) nunca sobrescrevem com zero.
- `/api/v1/tiktok/sync` mantém o contrato `ok`, `status`, `posts_updated`, `skipped_manual`, `sync_run_id`.
- `tracking_mode = api` nunca é rebaixado para `manual` em post do Zernio.
- Não alterar o fluxo `postforme`, Telegram, aprovação ou Buffer legado.

## Review Focus

- Geração após apagar `/tmp` não pode reutilizar caminho.
- Post Zernio já publicado não pode mostrar "Publicado TikTok" manual.
- `getPostMetrics` em post com `syncStatus = pending` retorna `null`, não zero.
- Sync manual não pode contar posts manuais nem falhar sem candidatos.
- Edição manual de post Zernio mantém `tracking_mode = api`.

---

### Task 1: Pasta única por geração

**Files:**
- Modify: `backend/src/domain/runs/generate.ts`
- Test: `backend/tests/runs/generate.test.ts`

**Interfaces:**
- Produces: `generateOneCarousel` continua `Promise<CarouselRun>`; `output_dir` segue `output/<data>/<conta>/post_<HHmmss>_<8hex>`.

- [ ] **Step 1: Write failing test** — duas gerações, apagando `tmpOutputDir` entre elas, têm `output_dir` diferentes e nenhum `storage_path` em comum.
- [ ] **Step 2: Run** `cd backend && DATABASE_URL= NODE_ENV=test npx tsx --test --test-concurrency=1 tests/runs/generate.test.ts` → FAIL (ambos `post_01`).
- [ ] **Step 3: Implement** com `randomUUID().slice(0,8)` e hora UTC; remover o uso de `nextPostIndex`.
- [ ] **Step 4: Run** mesmo comando → PASS.
- [ ] **Step 5: Commit.**

### Task 2: Status publicado no dispatch e reconciliação no polling

**Files:**
- Modify: `backend/src/domain/dispatch/service.ts`
- Modify: `backend/src/domain/social/polling.ts`
- Modify: `backend/src/domain/social/providers/zernio.ts` (`mapStatus`: `partial` → `published`)
- Test: `backend/tests/dispatch/social-dispatch.test.ts`, `backend/tests/social/polling.test.ts`, `backend/tests/social/zernio.test.ts`

**Interfaces:**
- Produces: dispatch com `publishRes.status = "published"` devolve `run.status = "published"`; polling reconcilia `tiktok_posts.publish_status = 'published'` com run não publicado.

- [ ] **Step 1: Write failing tests** — (a) dispatch published → run published; (b) polling com post já published e run dispatched → run published; (c) `mapStatus("partial") === "published"`.
- [ ] **Step 2: Run** os três arquivos → FAIL.
- [ ] **Step 3: Implement** update condicional no dispatch, `UPDATE ... FROM` no início do polling, e `partial` no `mapStatus`. Janela do polling para 7 dias.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 3: Métricas reais do Zernio

**Files:**
- Modify: `backend/src/domain/social/providers/zernio.ts`
- Modify: `backend/src/domain/social/metricsSync.ts`
- Test: `backend/tests/social/zernio.test.ts`, `backend/tests/social/metricsSync.test.ts`

**Interfaces:**
- Produces: `getPostMetrics(externalPostId): Promise<PostMetrics | null>` lê `analytics.getAnalytics({ query: { postId } })`; sync seleciona `provider = 'zernio'`.

- [ ] **Step 1: Write failing tests** — mapeia views/likes/comments/shares de `analytics`; retorna `null` com `syncStatus = "pending"`; sync ignora post `pending`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** no adapter e no worker.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 4: Sync real na API + campos do Zernio no desempenho

**Files:**
- Modify: `backend/src/domain/tiktok/store.ts`
- Modify: `backend/src/domain/tiktok/routes.ts`
- Modify: `backend/src/domain/tiktok/schemas.ts`
- Test: `backend/tests/tiktok/manual.test.ts`

**Interfaces:**
- Produces: `runTikTokSyncStub` executa `syncTikTokMetricsDailyJob`; `TikTokPerformanceItem` e `TikTokPost` carregam `provider`, `external_post_id`, `publish_status`, `last_polled_at`.

- [ ] **Step 1: Write failing test** — performance retorna os campos; sync com posts manuais retorna `posts_updated: 0`, `skipped_manual: N`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** selects/mappers e wrapper de sync.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 5: `tiktok_post` no run + preservar tracking na edição manual

**Files:**
- Modify: `backend/src/domain/runs/store.ts`
- Modify: `backend/src/domain/runs/schemas.ts`
- Modify: `backend/src/domain/tiktok/store.ts` (`upsertTikTokPost`)
- Test: `backend/tests/tiktok/manual.test.ts`, `backend/tests/runs/routes.test.ts`

**Interfaces:**
- Produces: `CarouselRun.tiktok_post` com `provider`, `external_post_id`, `publish_status`, `published_at`, `last_polled_at`; `upsertTikTokPost` preserva `tracking_mode` existente quando o post é do Zernio.

- [ ] **Step 1: Write failing test** — run com post Zernio devolve `tiktok_post`; PUT manual sobre post Zernio mantém `tracking_mode = 'api'` e não zera métricas omitidas.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** join e regra de preservação.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 6: Frontend — ID do Zernio, status e ações do card

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/tabs/PerformancePage.tsx`
- Modify: `frontend/src/components/RunCard.tsx`
- Modify: `frontend/src/components/ManualTikTokModal.tsx`
- Test: `frontend/src/run-card-buffer.test.ts`, `frontend/src/gallery-performance.test.ts`

**Interfaces:**
- Produces: `resolveBufferPublishState` retorna `published: boolean` quando `run.tiktok_post.publish_status === 'published'`; card esconde "Publicado TikTok" nesse caso e mostra Zernio como ação principal.

- [ ] **Step 1: Write failing tests** — run com `tiktok_post` publicado → `published: true`; run sem vínculo → Zernio invisível e manual visível.
- [ ] **Step 2: Run** `npm --prefix frontend run test` → FAIL.
- [ ] **Step 3: Implement** tipos, coluna/ID na tela, regras do card, modal preservando tracking.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 7: Verificação final

- [ ] `npm --prefix backend run test` (ou os arquivos alterados) → PASS.
- [ ] `npm --prefix backend run build` → PASS.
- [ ] `npm --prefix frontend run build` → PASS.
- [ ] Revisar diff e confirmar que nenhum run antigo foi alterado.
