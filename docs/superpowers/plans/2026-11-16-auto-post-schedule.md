# Auto Post Schedule + Buffer Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rotina automática serializada (3 posts/conta/dia em janelas sorteadas) com plano persistido, aprovação humana para Buffer, botão manual "Publicar no Buffer" na galeria, e painel de agenda em Integrações.

**Architecture:** Migration `004` cria `auto_post_slots` + flags. Planner diário + ticker de minuto (`AUTOMATION_CRON_SCHEDULE`) claima 1 slot por tick via `FOR UPDATE SKIP LOCKED` + `withJobLock`. Contas Buffer geram e ficam `awaiting_approval`; Telegram despacha na hora. Canal é re-resolvido na execução. UI: botão Buffer no `RunCard`, deep link `?tab=galeria&run=`, agenda em Integrações.

**Tech Stack:** TypeScript (ESM), Fastify, PostgreSQL/`pg`, node-cron, Grammy (Telegram), React 19, Vite, `node:test` + testcontainers.

**Spec:** `docs/superpowers/specs/2026-11-16-auto-post-schedule-design.md`

## Global Constraints

- Fuso padrão `America/Sao_Paulo` (`app_settings.auto_post_timezone` > `AUTOMATION_TZ` > `TZ` > default); sem lib de timezone nova (`Intl.DateTimeFormat`).
- `auto_dispatch_enabled` continua sendo o liga/desliga único da rotina; `CRON_SCHEDULE` deixa de gerar batch.
- Sem backfill: janela encerrada → `skipped`. Sem fallback Buffer→Telegram. Sem multi-instância além do claim Postgres + lock em memória.
- `MAX_ATTEMPTS = 2`, `RETRY_DELAY = 5min`, só se `now + 5min < window_end`.
- Imports ESM com sufixo `.js`. Testes backend: `NODE_ENV=test tsx --test --test-concurrency=1`. Frontend: `tsx --test "src/**/*.test.ts"`.
- Textos de UI/notificação em português conforme spec §5.6 / §5.9.

## Review Focus

1. Provider Buffer retorna `{ status: 'failed' }` sem throw → `dispatch_events` `failed`, run permanece `generated`, `buffer_dispatched_at` null, slot entra em retry (não marcar `sent`/`dispatched`).
2. Conta `postforme` com `external_account_id` → canal `social`, slot `skipped` com erro claro; **não** envia Telegram.
3. Retry de dispatch reutiliza `run_id` existente; nunca chama `generateOneCarousel` de novo para o mesmo slot.
4. Aprovação após `window_end` → 410, slot `skipped` (`aprovação expirada`); segunda aprovação em slot já `done` → `{ already: true }`.
5. `running` no boot → `failed` (`processo reiniciou…`); `dispatch_events` `sent` no canal resolvido impede re-dispatch após crash.

---

### Task 1: Migration + schemas de conta/run

**WDD class:** wiring

**Files:**
- Create: `backend/migrations/004_auto_post_schedule.sql`
- Modify: `backend/src/domain/accounts/schemas.ts` (`auto_post_enabled` em Account/Create/Update)
- Modify: `backend/src/domain/accounts/store.ts` (persistir coluna)
- Modify: `backend/src/domain/runs/schemas.ts` (`awaiting_approval` em `RUN_STATUSES`; `auto_post_slot_id`, `buffer_dispatched_at` no `CarouselRunSchema`)
- Modify: `frontend/src/types.ts` (mesmos campos em `Account` / `CarouselRun` / `RunStatus`)
- Test: `backend/tests/db/migration-004.test.ts`

**Interfaces:**
- Produces: tabela `auto_post_slots` (colunas/status exatamente como spec §5.2); `accounts.auto_post_enabled BOOLEAN NOT NULL DEFAULT true`; `carousel_runs.auto_post_slot_id`; opcional `tiktok_posts.notified_at TIMESTAMPTZ` para dedupe de notificação de polling.

- [ ] **Step 1: Write failing migration test** asserting columns/indexes/constraints exist after `runMigrations`.

- [ ] **Step 2: Run test — expect FAIL** (migration missing).

- [ ] **Step 3: Add `004_auto_post_schedule.sql` (SQL da spec §5.2 + `notified_at`) and extend Zod/store/frontend types.**

- [ ] **Step 4: Run migration test — expect PASS.**

- [ ] **Step 5: Commit** `feat(db): add auto_post_slots and schedule flags`

---

### Task 2: Time + windows helpers

**WDD class:** wiring

**Files:**
- Create: `backend/src/domain/automation/time.ts`
- Create: `backend/src/domain/automation/windows.ts`
- Test: `backend/tests/automation/time-windows.test.ts`

**Interfaces:**
- Produces:
  - `localDateString(date: Date, timeZone: string): string`
  - `zonedTimeToUtc(localDate: string, hhmm: string, timeZone: string): Date`
  - `addLocalDays(localDate: string, n: number): string`
  - `PostWindow { id, start, end }`, `DEFAULT_WINDOWS` (morning/midday/evening per spec)
  - `resolveAutomationTimezone(settings?, env?): string`
  - `resolvePostWindows(settings?, env?): PostWindow[]`
  - `resolvePostCountPerDay(settings?): number` (clamp 1–6, default 3)

- [ ] **Step 1: Write tests** — SP timezone conversion (known UTC offsets), DST iterate-once behavior smoke, default windows, clamp count, invalid window `start >= end` rejected by validator used later by settings.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement helpers with `Intl.DateTimeFormat` only.**

- [ ] **Step 4: Run — expect PASS. Commit** `feat(automation): add timezone and window helpers`

---

### Task 3: Planner

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/automation/planner.ts`
- Create: `backend/src/domain/automation/slots.ts` (CRUD/claim helpers SQL)
- Test: `backend/tests/automation/planner.test.ts`

**Interfaces:**
- Consumes: time/windows helpers; `getSetting` / pool; `listAccounts` or SQL direto.
- Produces: `ensureDailyPlan(options: { pool, now?: Date, randomInt?: (max: number) => number }): Promise<{ created: number; skippedExpired: number }>`
  - Fatias iguais (spec §5.1); `ON CONFLICT DO NOTHING`; expira `pending` com `window_end < now` ou `slot_date < today` → `skipped` (`janela encerrada`).
  - Se `auto_dispatch_enabled === false`: só expira, não cria.
  - Contas: `enabled AND auto_post_enabled`; `auto_post_count_per_day` = N primeiras janelas.
  - Canal planejado na criação: buffer se `external_account_id` + provider buffer/null/empty; `social` se postforme; senão telegram.

- [ ] **Step 1: Write failing tests** covering spec §5.11 items 1–6, 25–26 (3 contas/fatias, idempotência, boot meio-dia, conta nova, disabled, toggle off, `auto_post_enabled=false`, count=2).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement planner + slot SQL helpers. Shuffle via `crypto.randomInt` (injetável).**

- [ ] **Step 4: Run — expect PASS. Commit** `feat(automation): persist daily auto-post plan`

---

### Task 4: Fix Buffer `failed` in dispatch

**WDD class:** dense

**Files:**
- Modify: `backend/src/domain/dispatch/service.ts`
- Test: `backend/tests/dispatch/social-dispatch.test.ts` (extend) or `backend/tests/dispatch/buffer-failed.test.ts`

**Interfaces:**
- Consumes: existing `dispatchCarouselRun`
- Produces: when `publishRes.status === 'failed'`: upsert `tiktok_posts` with `publish_status='failed'`, `dispatch_events.status='failed'`, **do not** set run to `dispatched`, throw `AppError`. `buffer_dispatched_at` only from `sent`.

- [ ] **Step 1: Write failing test** — fake publisher returns `{ status: 'failed', errorMessage: '…' }` without throw; assert event failed, run `generated`, no successful buffer sent_at.

- [ ] **Step 2: Run — expect FAIL (hoje trata como sucesso).**

- [ ] **Step 3: Fix success-path branch in `dispatchCarouselRun`.**

- [ ] **Step 4: Run — expect PASS. Commit** `fix(dispatch): treat buffer failed status as error`

---

### Task 5: Notifications helper

**WDD class:** wiring

**Files:**
- Create: `backend/src/domain/automation/notifications.ts`
- Test: `backend/tests/automation/notifications.test.ts`

**Interfaces:**
- Produces: `getNotifyChatId(): string | null` (`TELEGRAM_NOTIFY_CHAT_ID` || `TELEGRAM_CHAT_ID`)
- `notifyAutomation(event, payload, { telegramApi? })` com templates PT da spec §5.6
- `buildApprovalKeyboard(runId, appBaseUrl?)` → inline `Confirmar envio` (`callback_data = approve_buffer:<runId>`) + URL opcional `APP_BASE_URL/?tab=galeria&run=<runId>`

- [ ] **Step 1–4: TDD** notify chat resolution + keyboard shape; commit `feat(automation): telegram notification helpers`

---

### Task 6: Ticker + executeSlot

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/automation/ticker.ts`
- Create: `backend/src/domain/automation/approve.ts` (shared approve used by HTTP + bot; can land here or Task 7 — prefer create stub used by ticker expiry only if needed)
- Test: `backend/tests/automation/ticker.test.ts`

**Interfaces:**
- Consumes: `ensureDailyPlan`, `generateOneCarousel`, `dispatchCarouselRun`, `withJobLock`/`getJobStatus`, notifications
- Produces: `runAutomationTick(options: { pool, now?, generateFn?, dispatchFn?, notifyFn? }): Promise<{ ran: boolean; reason?: string }>`
  - Spec §5.4 / §5.4.1 expiry of `awaiting_approval`
  - Module `tickerBusy` reentrancy
  - Boot recovery: any `running` → `failed` (`processo reiniciou…`) when `options.recoverStaleRunning === true` or first call from `startCron`
  - Stale `running` >15min → `failed`
  - Claim SQL da spec; one slot per tick
  - `executeSlot` channel resolve + reuse `run_id` + Buffer→`awaiting_approval` + Telegram→dispatch `triggeredBy: 'auto_schedule'` + retry rules
  - postforme → skip; published without channel sent → skip; channel sent → done

- [ ] **Step 1: Write failing tests** for spec §5.11 items 7–12, 17, 19–21.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement ticker/executor with injectable generate/dispatch/notify.**

- [ ] **Step 4: Run — expect PASS. Commit** `feat(automation): minute ticker and slot executor`

---

### Task 7: Approval API + Telegram callback

**WDD class:** dense

**Files:**
- Create: `backend/src/domain/automation/approve.ts` (if not in Task 6)
- Create: `backend/src/domain/automation/routes.ts`
- Modify: `backend/src/app.ts` (`v1.register(automationRoutes, { prefix: "/automation" })`)
- Modify: `backend/src/bot.ts` (`bot.on('callback_query:data', …)` for `approve_buffer:`)
- Test: `backend/tests/automation/approval.test.ts`

**Interfaces:**
- Produces: `approveBufferRun(runId, options): Promise<{ ok: true; already?: boolean; run }>`
  - Claim `UPDATE … WHERE status='awaiting_approval'`; expired → skip + 410 mapping in route; already done → `{ already: true }`
  - `dispatchCarouselRun({ channel: 'buffer', triggeredBy: 'approval' })`
- Route: `POST /api/v1/automation/runs/:runId/approve`
- Bot: answerCallbackQuery + edit message; same `approveBufferRun`

- [ ] **Step 1: Write failing tests** §5.11 items 22–24.

- [ ] **Step 2–4: Implement + PASS. Commit** `feat(automation): buffer approval endpoint and telegram callback`

---

### Task 8: Schedule read API + settings validation + cron rewire

**WDD class:** scaffold

**Files:**
- Modify: `backend/src/domain/automation/routes.ts` — `GET /schedule?date=`
- Modify: `backend/src/domain/settings/routes.ts` — validate `auto_post_windows` (`start < end`), `auto_post_count_per_day` (1–6), `auto_post_timezone` (non-empty string) on PUT
- Modify: `backend/src/cron.ts` — replace batch with `automationTask` on `AUTOMATION_CRON_SCHEDULE` default `* * * * *`; `RunningCronTasks` exposes `automationTask`; boot calls recover + one tick
- Modify: `backend/tests/runs/cron-filter.test.ts` — drop `runCronTick` generation assumptions; assert automation schedule wiring
- Test: `backend/tests/automation/routes.test.ts`

**Interfaces:**
- Produces: schedule JSON shape spec §5.8 (`account_enabled`, `run_status`, `post_status` joins)
- Invalid date → 400 `validation_error`
- Endpoint read-only (does not call planner create)

- [x] **Step 1–4: TDD schedule route + settings 400 + cron shape. Commit** `feat(automation): schedule API, settings validation, minute cron`

---

### Task 9: Read model `buffer_dispatched_at`

**WDD class:** wiring

**Files:**
- Modify: `backend/src/domain/runs/store.ts` (`getCarouselRun` + `listCarouselRuns` subquery spec §5.8)
- Test: `backend/tests/runs/buffer-dispatched-at.test.ts` (or extend existing runs store test)

**Interfaces:**
- Produces: `buffer_dispatched_at: Date | null` from latest `dispatch_events` where `channel IN ('buffer','social')` AND `status='sent'`

- [x] **Step 1–4: TDD. Commit** `feat(runs): expose buffer_dispatched_at on carousel runs`

---

### Task 10: Polling notifications for auto slots

**WDD class:** scaffold

**Files:**
- Modify: `backend/src/domain/social/polling.ts`
- Test: `backend/tests/social/polling.test.ts` (extend)

**Interfaces:**
- On transition `queued|processing` → `published|failed`, if run has `auto_post_slot_id` and `tiktok_posts.notified_at` is null: send final notify; set `notified_at`. Manual posts (no slot) stay silent.

- [x] **Step 1–4: TDD §5.11 item 28. Commit** `feat(polling): notify auto-schedule publish outcomes`

---

### Task 11: Frontend Buffer button + API channel

**WDD class:** dense

**Files:**
- Modify: `frontend/src/api.ts` — `dispatchCarouselRun(runId, channel: "telegram"|"api"|"buffer"|"social")`; add `approveAutomationRun(runId)`
- Modify: `frontend/src/components/RunCard.tsx` — export `resolveBufferPublishState`; badge Buffer; botão
- Modify: `frontend/src/tabs/GalleryPage.tsx` — `accountsById` → pass `account` into `RunCard`
- Test: `frontend/src/run-card-buffer.test.ts`

**Interfaces:**
- Produces: `resolveBufferPublishState(account, run) → { visible, disabled, label }` regras §5.9.1
- Clique: `awaiting_approval`/`Confirmar envio` → `approveAutomationRun`; senão → `dispatchCarouselRun(..., 'buffer')`

- [ ] **Step 1: Write failing tests** §5.11 frontend 1–5, 8, 10.

- [ ] **Step 2–4: Implement + PASS. Commit** `feat(gallery): buffer publish and confirm buttons`

---

### Task 12: Agenda panel + settings copy + account toggle

**WDD class:** dense

**Files:**
- Modify: `frontend/src/api.ts` — `getAutomationSchedule(date?)`
- Modify: `frontend/src/types.ts` — `AutoPostSlot`, `AutomationSchedule`; `auto_post_enabled` on Account; settings keys
- Modify: `frontend/src/tabs/IntegrationsPage.tsx` — copy da rotina; agenda table; reload 60s; windows/count/tz editors via `updateSetting`
- Modify: accounts UI (Accounts page / form) — toggle `auto_post_enabled`
- Create helpers: `formatScheduleStatus`, `formatScheduleChannel`, `formatPublicationStatus` (export for tests)
- Test: `frontend/src/automation-schedule.test.ts`

**Interfaces:**
- Status labels: pending→Agendado, running→Gerando/Publicando, awaiting_approval→Aguardando aprovação, done→Enviado, failed→Falhou, skipped→Pulado
- Channels: buffer→Buffer, telegram→Telegram, social→Social
- Publication: queued/processing/published/failed/null per spec

- [ ] **Step 1–4: TDD helpers + API fetch contract; wire UI. Commit** `feat(integrations): auto-post schedule panel and config`

---

### Task 13: Deep link galeria

**WDD class:** scaffold

**Files:**
- Modify: `frontend/src/App.tsx` — export `parseDeepLinkParams(search: string): { tab?: NavTab; runId?: string }`; init tab + `focusedRunId`; popstate
- Modify: `frontend/src/tabs/GalleryPage.tsx` — `focusedRunId` scroll + `run-card--focused`; banner se ausente
- Test: `frontend/src/deep-link.test.ts`

**Interfaces:**
- `?tab=galeria&run=<uuid>` → tab galeria + focus

- [x] **Step 1–4: TDD parse + wire. Commit** `feat(gallery): deep link focus for approval`

---

### Task 14: README env docs

**WDD class:** wiring

**Files:**
- Modify: `README.md` (or backend README if that is where env is documented)

**Interfaces:**
- Document: `AUTOMATION_TZ`, `AUTO_POST_WINDOWS`, `AUTOMATION_CRON_SCHEDULE`, `TELEGRAM_NOTIFY_CHAT_ID`, `APP_BASE_URL`; note `CRON_SCHEDULE` obsolete for generation; describe Buffer button + approval flow in one short section.

- [ ] **Step 1: Update docs. Step 2: Commit** `docs: document auto-post schedule and buffer publish`

---

## Self-review notes

- Spec §5.11 backend 1–29 and frontend 1–12 mapped to Tasks 1–13.
- Builder choices locked: `Intl` only; `crypto.randomInt`; agenda poll 60s; window validation `start < end` only; `notified_at` for polling dedupe.
- Cross-agent review required on Tasks 3, 4, 6, 7, 11, 12 (`dense`).
