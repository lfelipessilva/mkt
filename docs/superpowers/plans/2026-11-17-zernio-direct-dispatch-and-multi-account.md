# Zernio Direct Dispatch, Multi-Account API Keys & Telegram Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable automatic direct dispatch to Zernio without manual approval, support per-account Zernio API keys across backend and frontend, and ensure reliable Telegram notifications on dispatch and failures.

**Architecture:** Add `zernio_api_key` column to `accounts` table and update the Zernio publisher adapter to support scoped API keys with env fallback. Modify the auto-post ticker to immediately dispatch slots configured with channel `zernio` instead of holding them in `awaiting_approval`. Update notification helpers to initialize the Telegram client when running in the background cron and format rich error messages.

**Tech Stack:** Node.js, Fastify, TypeScript, PostgreSQL (pg), Grammy (Telegram bot), React, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-11-17-zernio-direct-dispatch-and-multi-account-design.md`

## Global Constraints

- Never break existing accounts: if `zernio_api_key` is not configured, fall back to global `process.env.ZERNIO_API_KEY`.
- No manual approval required for automated Zernio post slots: direct dispatch on schedule execution.
- Auto-post schedule channel for Zernio remains `zernio`.
- All notifications sent to `TELEGRAM_NOTIFY_CHAT_ID` or `TELEGRAM_CHAT_ID`.
- UI must mask the API key field as password input with visibility toggle.

## Review Focus

1. Empty or whitespace `zernio_api_key`: must fall back to `process.env.ZERNIO_API_KEY` without throwing validation errors.
2. Direct Zernio dispatch failure in ticker: slot must record `last_error`, trigger retry or fail, and immediately send `publish_failed` notification to Telegram with the failure reason.
3. Automated cron tick with no pre-injected `telegramApi`: `notifyAutomation` must gracefully fallback to `new Api(process.env.TELEGRAM_BOT_TOKEN)` instead of dropping notifications silently.
4. Legacy manual approval flow: remains backward-compatible if called directly via HTTP or bot callback.
5. Account update in UI: saving an account without changing `zernio_api_key` must preserve or update the key correctly.

---

### Task 1: Database Migration & Accounts Store for `zernio_api_key`

**WDD class:** dense

**Files:**
- Create: `backend/migrations/007_account_zernio_api_key.sql`
- Modify: `backend/src/domain/accounts/schemas.ts:12-57`
- Modify: `backend/src/domain/accounts/store.ts:1-120`
- Test: `backend/tests/accounts/store-social-fields.test.ts`

**Interfaces:**
- Produces: `Account.zernio_api_key?: string | null`, `CreateAccountInput.zernio_api_key?: string | null`, `UpdateAccountInput.zernio_api_key?: string | null`
- Consumes: PostgreSQL `accounts` table

- [x] **Step 1: Write the failing test**

In `backend/tests/accounts/store-social-fields.test.ts`, add test verifying that `upsertAccount` saves and updates `zernio_api_key` and that schemas accept it:

```ts
test("upsertAccount saves and returns zernio_api_key", async () => {
  const account = await upsertAccount({
    id: "test-zernio-key-acc",
    persona: "Test",
    role: "single_woman",
    zernio_api_key: "zk_test_custom_key_123",
  });
  assert.strictEqual(account.zernio_api_key, "zk_test_custom_key_123");

  const fetched = await getAccount("test-zernio-key-acc");
  assert.strictEqual(fetched?.zernio_api_key, "zk_test_custom_key_123");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test tests/accounts/store-social-fields.test.ts`
Expected: FAIL (property `zernio_api_key` does not exist or column not found).

- [x] **Step 3: Create migration and update schemas & store**

1. Create `backend/migrations/007_account_zernio_api_key.sql`:
```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS zernio_api_key TEXT;
```
2. In `backend/src/domain/accounts/schemas.ts`, add `zernio_api_key: z.string().nullable().optional()` to `AccountSchema`, `CreateAccountSchema`, and `UpdateAccountSchema`.
3. In `backend/src/domain/accounts/store.ts`, update `listAccounts`, `getAccount`, `upsertAccount`, and `updateAccount` SQL queries to include `zernio_api_key`.

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend && npx tsx --test tests/accounts/store-social-fields.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend/migrations/007_account_zernio_api_key.sql backend/src/domain/accounts/schemas.ts backend/src/domain/accounts/store.ts backend/tests/accounts/store-social-fields.test.ts
git commit -m "feat(accounts): add zernio_api_key column and schema support"
```

---

### Task 2: Per-Account Zernio Publisher Adapter & Dispatch Integration

**WDD class:** dense

**Files:**
- Modify: `backend/src/domain/social/providers/zernio.ts:110-130`
- Modify: `backend/src/domain/social/factory.ts:6-17`
- Modify: `backend/src/domain/dispatch/service.ts:317-375`
- Modify: `backend/src/domain/social/polling.ts:38-120`
- Modify: `backend/src/domain/social/metricsSync.ts:30-100`
- Test: `backend/tests/social/zernio.test.ts`
- Test: `backend/tests/dispatch/social-dispatch.test.ts`

**Interfaces:**
- Consumes: `Account.zernio_api_key`
- Produces: `getSocialPublisherProvider(providerName, { apiKey?: string })`

- [x] **Step 1: Write the failing test**

In `backend/tests/social/zernio.test.ts`, add test verifying that `ZernioPublisherAdapter` uses custom API key passed in constructor:

```ts
test("ZernioPublisherAdapter uses apiKey provided to constructor over env", async () => {
  const adapter = new ZernioPublisherAdapter(undefined, "zk_custom_test_key");
  assert.strictEqual((adapter as any).apiKey, "zk_custom_test_key");
});
```

And in `backend/tests/dispatch/social-dispatch.test.ts`, add test verifying that `dispatchCarouselRun` resolves the account's `zernio_api_key`:

```ts
test("dispatchCarouselRun uses account.zernio_api_key when dispatching to zernio", async () => {
  // asserts that custom social publisher is called with account's zernio_api_key
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test tests/social/zernio.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement per-account API key in adapter, factory, dispatch, polling & metrics**

1. In `backend/src/domain/social/providers/zernio.ts`:
   Update constructor: `constructor(private readonly client?: ZernioSdk, readonly apiKey?: string)`
   In `sdk()`: `const apiKey = this.apiKey || process.env.ZERNIO_API_KEY;`
2. In `backend/src/domain/social/factory.ts`:
   Update `getSocialPublisherProvider(name?: string, options?: { apiKey?: string }): SocialPublisherProvider` to pass `options?.apiKey` to `ZernioPublisherAdapter(undefined, options?.apiKey)`.
3. In `backend/src/domain/dispatch/service.ts`:
   In `options.channel === "zernio"` block:
   ```ts
   const accountKey = account.zernio_api_key?.trim() || undefined;
   const provider = options.socialPublisherProvider || customSocialPublisherProvider || getSocialPublisherProvider("zernio", { apiKey: accountKey });
   ```
4. In `backend/src/domain/social/polling.ts` and `metricsSync.ts`:
   Resolve the post's account and pass its `zernio_api_key` when instantiating the publisher provider.
5. In `backend/tests/social/zernio.test.ts`: fix the existing test assertion on `saves: 0` to align with schema.

- [x] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx tsx --test tests/social/zernio.test.ts tests/dispatch/social-dispatch.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend/src/domain/social/providers/zernio.ts backend/src/domain/social/factory.ts backend/src/domain/dispatch/service.ts backend/src/domain/social/polling.ts backend/src/domain/social/metricsSync.ts backend/tests/social/zernio.test.ts backend/tests/dispatch/social-dispatch.test.ts
git commit -m "feat(social): support per-account zernio api key in adapter and dispatch"
```

---

### Task 3: Direct Automated Dispatch to Zernio (Eliminate `awaiting_approval`)

**WDD class:** dense

**Files:**
- Modify: `backend/src/domain/automation/ticker.ts:315-337`
- Test: `backend/tests/automation/ticker.test.ts`

**Interfaces:**
- Consumes: `dispatchFn({ runId, channel: "zernio", triggeredBy: "auto_schedule", pool })`
- Produces: Slot updated to `done` on success or retried on error, without holding in `awaiting_approval`.

- [x] **Step 1: Write the failing test**

In `backend/tests/automation/ticker.test.ts`, add test verifying that when a slot has channel `zernio`, `runAutomationTick` immediately dispatches to Zernio and marks the slot as `done`:

```ts
test("slot with channel zernio is dispatched directly to zernio without awaiting approval", async () => {
  let dispatchedChannel: string | null = null;
  const customDispatchFn = async (opts: any) => {
    dispatchedChannel = opts.channel;
    return { ok: true, event: { status: "sent" } } as any;
  };

  // Setup account with external_account_id, auto_dispatch_enabled=true, and a pending zernio slot
  // Run runAutomationTick with customDispatchFn
  // Assert dispatchedChannel === "zernio"
  // Assert slot status is "done" (not "awaiting_approval")
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test tests/automation/ticker.test.ts`
Expected: FAIL (slot is set to `awaiting_approval` instead of being dispatched and marked `done`).

- [x] **Step 3: Implement direct Zernio dispatch in `ticker.ts`**

In `backend/src/domain/automation/ticker.ts`, replace lines 315-336 (`if (channel === "zernio") { status: "awaiting_approval" ... }`) with direct execution:

```ts
  if (channel === "zernio") {
    const dispatchFn: DispatchCarouselFn =
      options.dispatchFn ||
      (async (opts) =>
        dispatchCarouselRun({
          runId: opts.runId,
          channel: opts.channel,
          triggeredBy: opts.triggeredBy || "auto_schedule",
          pool: opts.pool,
        }));

    try {
      const result = await dispatchFn({
        runId: run.id,
        channel: "zernio",
        triggeredBy: "auto_schedule",
        pool,
      });

      if (result?.event?.status === "failed") {
        const reason =
          result.event.response_payload?.error ||
          result.event.response_payload?.message ||
          "falha no dispatch zernio";
        throw new Error(reason);
      }

      await updateSlot(
        slot.id,
        {
          channel: "zernio",
          status: "done",
          finished_at: now,
        },
        pool
      );

      await notifyFn(
        "buffer_accepted",
        {
          account: account.id,
          archetype: run.archetype_title,
          runId: run.id,
        },
        notifyOpts
      ).catch(() => {});
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      await notifyFn(
        "publish_failed",
        {
          account: account.id,
          reason: errorMsg,
          runId: run.id,
        },
        notifyOpts
      ).catch(() => {});
      await handleRetry(slot, errorMsg, now, pool);
    }
    return;
  }
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend && npx tsx --test tests/automation/ticker.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend/src/domain/automation/ticker.ts backend/tests/automation/ticker.test.ts
git commit -m "feat(automation): dispatch zernio slots directly without requiring manual approval"
```

---

### Task 4: Telegram Notifications Fallback & Error Formatting

**WDD class:** wiring

**Files:**
- Modify: `backend/src/domain/automation/notifications.ts:1-108`
- Test: `backend/tests/automation/notifications.test.ts`

**Interfaces:**
- Produces: `notifyAutomation` with automatic `process.env.TELEGRAM_BOT_TOKEN` client fallback and clear Portuguese messages for Zernio success and failure.

- [x] **Step 1: Write the failing test**

In `backend/tests/automation/notifications.test.ts`, test that `notifyAutomation` instantiates `Api` if `telegramApi` is omitted but `TELEGRAM_BOT_TOKEN` is present:

```ts
test("notifyAutomation creates Api client using TELEGRAM_BOT_TOKEN when options.telegramApi is undefined", async () => {
  // Test fallback creation
});

test("formatMessage formats clear Zernio sent and detailed publish_failed messages", () => {
  // Test message text contains account, archetype, and error reason
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test tests/automation/notifications.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement client fallback and message templates**

1. In `backend/src/domain/automation/notifications.ts`:
   - Import `Api` from `grammy`.
   - Update `formatMessage`:
     - `buffer_accepted`: `📤 Enviado ao Zernio / TikTok — @${account} — arquétipo: ${payload.archetype ?? ""}`
     - `publish_failed`: `❌ Falha na publicação Zernio — @${account} — motivo: ${payload.reason ?? "erro desconhecido"}`
     - `generation_failed`: `❌ Falha ao gerar carrossel — @${account} — motivo: ${payload.reason ?? "erro desconhecido"}`
   - In `notifyAutomation`:
     ```ts
     const api = options.telegramApi || (process.env.TELEGRAM_BOT_TOKEN ? new Api(process.env.TELEGRAM_BOT_TOKEN) : undefined);
     if (!chatId || !api) return;
     ...
     await api.sendMessage(chatId, text, extra);
     ```

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend && npx tsx --test tests/automation/notifications.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend/src/domain/automation/notifications.ts backend/tests/automation/notifications.test.ts
git commit -m "feat(notifications): add telegram client fallback in cron and detail error messages"
```

---

### Task 5: Frontend Account Form & Types for `zernio_api_key`

**WDD class:** wiring

**Files:**
- Modify: `frontend/src/types.ts:1-70`
- Modify: `frontend/src/tabs/settings/AccountsPage.tsx:42-250`
- Test: `frontend/src/accounts.test.ts`

**Interfaces:**
- Consumes: `Account.zernio_api_key`
- Produces: Form input field for per-account Zernio API key with password mask and visibility toggle.

- [x] **Step 1: Write the failing test**

In `frontend/src/accounts.test.ts`, add test checking that `createAccount` and `updateAccount` send `zernio_api_key`:

```ts
test("updateAccount passes zernio_api_key when provided", async () => {
  let capturedBody: any = null;
  // mock fetch and verify capturedBody.zernio_api_key is sent
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test`
Expected: FAIL.

- [x] **Step 3: Update frontend types and account modal**

1. In `frontend/src/types.ts`:
   Add `zernio_api_key?: string | null` to `Account`, `CreateAccountInput`, `UpdateAccountInput`.
2. In `frontend/src/tabs/settings/AccountsPage.tsx`:
   - Add `zernio_api_key: string` to `AccountFormState` and `emptyFormState`.
   - In the modal form, add a Field for "Chave API Zernio (opcional)":
     - Type `password` with a show/hide toggle button (Eye / EyeOff icon from lucide-react).
     - Hint: "Se vazio, usa a chave padrão do sistema (ZERNIO_API_KEY do .env)."
     - Placeholder: "zk_..."
   - Populate `zernio_api_key: acc.zernio_api_key || ""` when opening the edit modal.
   - Include `zernio_api_key: form.zernio_api_key ? form.zernio_api_key.trim() : null` in submit handler.

- [x] **Step 4: Run frontend tests & build**

Run: `npm --prefix frontend test && npm --prefix frontend run build`
Expected: PASS with 0 errors.

- [x] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/tabs/settings/AccountsPage.tsx frontend/src/accounts.test.ts
git commit -m "feat(frontend): add zernio_api_key field with password mask to accounts settings"
```

---

### Task 6: Full Regression & End-to-End Verification

**WDD class:** dense

**Files:**
- Modify: `backend/tests/social/e2e-buffer-flow.test.ts` (if needed for saves/zernio updates)
- Modify: `backend/tests/social/metricsSync.test.ts` (if needed for saves/zernio updates)

- [x] **Step 1: Run full backend test suite**

Run: `npm --prefix backend test`
Expected: All tests pass.

- [x] **Step 2: Run full frontend test suite & build**

Run: `npm --prefix frontend test && npm --prefix frontend run build`
Expected: All tests pass.

- [x] **Step 3: Final commit & verify git status**

```bash
git status
```
Ensure working tree is clean.
