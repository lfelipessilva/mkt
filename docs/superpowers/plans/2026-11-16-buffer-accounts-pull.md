# Puxar Contas do Buffer e Atualizar Informações pelo Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the ability to pull channels from Buffer (auto-importing new channels and updating existing linkages) and update account information directly via the frontend.

**Architecture:** The backend accounts store and schema are updated to persist social provider fields (`external_account_id`, `social_provider`). The social accounts sync service is enhanced to auto-create local accounts for newly discovered Buffer channels. The frontend API and UI (`AccountsPage.tsx` and `IntegrationsPage.tsx`) are updated with "Puxar Contas do Buffer" actions, Buffer badges, and editable Buffer link fields.

**Tech Stack:** TypeScript, Node.js, Fastify, PostgreSQL (`pg`), React 18, Vite, Lucide icons, Node test runner (`tsx --test`).

**Spec:** `docs/superpowers/specs/2026-11-16-buffer-accounts-pull-design.md`

## Global Constraints

- Node >= 20, TypeScript 5.7+ with ESM imports (`.js` extension in backend imports).
- Frontend tests run with `npm run test:frontend`.
- Backend unit tests run with `npx tsx --test <test-path>`.
- Preserves the Free tier limit of max 3 active accounts under the `buffer` provider.
- Clean rollback and non-destructive upserts for existing account data.

## Review Focus

1. **Unsanitized channel names:** When Buffer returns a username with `@` prefix or spaces, the imported account ID must sanitize them (`@user_name` -> `user_name`) to comply with `/^[a-zA-Z0-9_.-]+$/`.
2. **Preservation of existing account personas on sync:** When an existing account matches a Buffer channel, the sync must NOT overwrite its existing `persona`, `role`, or `display_name` with empty values.
3. **Empty / missing Buffer credentials:** When `BUFFER_ACCESS_TOKEN` is not set or Buffer returns an error, the sync endpoint must return a structured 400/502 error instead of crashing the server.
4. **Manual editing of external_account_id in frontend:** When an account is edited in `AccountsPage`, updating or clearing the `external_account_id` must persist to the database without dropping `social_provider`.
5. **UI loading state during sync:** When "Puxar Contas do Buffer" is clicked, buttons must be disabled and display a loading indicator until the request completes.

---

### Task 1: Backend Accounts Schema & Store Persistence for Social Provider Fields

**WDD class:** wiring

**Files:**
- Modify: `backend/src/domain/accounts/schemas.ts`
- Modify: `backend/src/domain/accounts/store.ts`
- Test: `backend/tests/accounts/store-social-fields.test.ts`

**Interfaces:**
- Consumes: PostgreSQL connection from `backend/src/shared/db/client.ts`
- Produces: `upsertAccount` saving `external_account_id`, `social_provider`, and `social_account_metadata`; `CreateAccountSchema` and `UpdateAccountSchema` accepting these fields.

- [ ] **Step 1: Write unit test for `upsertAccount` with social provider fields**

Create `backend/tests/accounts/store-social-fields.test.ts`:
Assert that `upsertAccount` saves and updates `external_account_id` and `social_provider`, and returns them in the returned `Account` object.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test tests/accounts/store-social-fields.test.ts`  
Expected: FAIL (fields not saved/returned by `upsertAccount`).

- [ ] **Step 3: Update `schemas.ts` and `store.ts`**

Update `CreateAccountSchema` and `UpdateAccountSchema` in `backend/src/domain/accounts/schemas.ts` to include:
```ts
external_account_id: z.string().nullable().optional(),
social_provider: z.string().nullable().optional(),
social_account_metadata: z.record(z.string(), z.unknown()).optional(),
```
Update `UpsertAccountInput` and `upsertAccount` in `backend/src/domain/accounts/store.ts` to insert and update `external_account_id`, `social_provider`, `social_account_metadata`, and return them in `RETURNING ...`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx tsx --test tests/accounts/store-social-fields.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/accounts/schemas.ts backend/src/domain/accounts/store.ts backend/tests/accounts/store-social-fields.test.ts
git commit -m "feat(accounts): support social provider fields in schema and store upsert"
```

---

### Task 2: Backend Social Accounts Sync Auto-Import

**WDD class:** wiring

**Files:**
- Modify: `backend/src/domain/social/routes.ts`
- Test: `backend/tests/social/sync-auto-import.test.ts`

**Interfaces:**
- Consumes: `BufferPublisherAdapter.listConnectedAccounts()`, `upsertAccount`, `listAccounts`
- Produces: `syncSocialAccounts(pool, provider)` returning `{ synced: number, matched: number, created: number, accounts: [...] }`.

- [ ] **Step 1: Write unit test for `syncSocialAccounts` auto-import**

Create `backend/tests/social/sync-auto-import.test.ts`:
- Mock provider returning 2 channels: one matching an existing account (`gabriel_tech`), and one new channel (`novo_canal_tiktok`).
- Assert that `syncSocialAccounts`:
  1. Links `gabriel_tech` to its `externalAccountId` without altering its persona.
  2. Auto-creates a new account `novo_canal_tiktok` with `social_provider = 'buffer'`, `external_account_id`, `enabled = true`.
  3. Returns `created: 1, matched: 1, synced: 2`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test tests/social/sync-auto-import.test.ts`  
Expected: FAIL (unmatched channels are not created as accounts).

- [ ] **Step 3: Implement auto-import in `syncSocialAccounts` in `backend/src/domain/social/routes.ts`**

For any channel in `channels` not matched with an existing account:
- Sanitize username into an ID: `const cleanId = (ch.username || ch.name).replace(/^@/, "").replace(/[^a-zA-Z0-9_.-]/g, "_").toLowerCase().trim();`
- Call `upsertAccount`:
  ```ts
  await upsertAccount({
    id: cleanId,
    display_name: ch.name || cleanId,
    role: "single_woman",
    persona: `Conta importada via Buffer (${ch.username || ch.name})`,
    enabled: true,
    social_provider: ch.provider,
    external_account_id: ch.externalAccountId,
  }, p);
  ```
- Increment `createdCount`.
- Return `{ synced: channels.length, matched: matchedCount, created: createdCount, accounts: matchedAccounts }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx tsx --test tests/social/sync-auto-import.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/social/routes.ts backend/tests/social/sync-auto-import.test.ts
git commit -m "feat(social): auto-import unmapped Buffer channels during social accounts sync"
```

---

### Task 3: Frontend API & Types Support for Social Provider & Sync

**WDD class:** wiring

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Test: `frontend/src/accounts.test.ts`

**Interfaces:**
- Consumes: Backend `/api/v1/social/accounts/sync` and `/api/v1/accounts`
- Produces: `Account` with `external_account_id` and `social_provider`; `syncSocialAccounts(): Promise<SyncAccountsResult>`.

- [ ] **Step 1: Write failing frontend unit tests**

In `frontend/src/accounts.test.ts`, add test cases:
1. `syncSocialAccounts calls POST /api/v1/social/accounts/sync and returns sync stats`.
2. `updateAccount passes external_account_id and social_provider`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:frontend`  
Expected: FAIL (`syncSocialAccounts` not defined).

- [ ] **Step 3: Update `types.ts` and `api.ts`**

In `frontend/src/types.ts`:
- Add `external_account_id?: string | null` and `social_provider?: string | null` to `Account`, `CreateAccountInput`, `UpdateAccountInput`.
- Export `SyncAccountsResult` interface: `{ synced: number; matched: number; created: number; accounts: Array<...> }`.

In `frontend/src/api.ts`:
- Add `syncSocialAccounts(): Promise<SyncAccountsResult>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:frontend`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/accounts.test.ts
git commit -m "feat(frontend): add syncSocialAccounts and social provider fields to types and api"
```

---

### Task 4: Frontend AccountsPage & IntegrationsPage UI Enhancements

**WDD class:** wiring

**Files:**
- Modify: `frontend/src/tabs/settings/AccountsPage.tsx`
- Modify: `frontend/src/tabs/IntegrationsPage.tsx`
- Test: `frontend/src/accounts.test.ts`

**Interfaces:**
- Consumes: `syncSocialAccounts`, `reloadAccounts`, `updateAccount`, `useAccount`
- Produces: UI button "Puxar Contas do Buffer", Buffer status column/badges, Buffer edit fields, and Buffer card on Integrations page.

- [ ] **Step 1: Write unit tests for Account UI logic and state**

In `frontend/src/accounts.test.ts`:
- Test that Buffer linkage status helper returns correct label/badge state for linked vs unlinked accounts.

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `npm run test:frontend`  

- [ ] **Step 3: Update `AccountsPage.tsx`**

1. Add a **"Puxar Contas do Buffer"** button in `page-section-header` next to "Adicionar Conta".
2. Handle loading state (`syncingBuffer`) and display feedback banner (`statusMessage`) with count of synced and created accounts.
3. In `table.data-table`:
   - Add column **"Buffer / Canal"**: displays a badge with the Buffer external account ID or "Não vinculado".
4. In modal forms (Create & Edit):
   - Add an optional input for `external_account_id` (ID do Canal Buffer) and display current `social_provider`.

- [ ] **Step 4: Update `IntegrationsPage.tsx`**

1. Add Card 3: **"Buffer Social Publishing"**:
   - Badge: `Buffer API`
   - Description: "Sincroniza canais do TikTok conectados ao Buffer e permite despacho direto de carrosséis."
   - Action button: **"Puxar Contas do Buffer"** calling `syncSocialAccounts()`.
   - Feedback status message upon completion.

- [ ] **Step 5: Run frontend and backend tests**

Run: `npm run test:frontend`  
Expected: PASS (all tests pass).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/tabs/settings/AccountsPage.tsx frontend/src/tabs/IntegrationsPage.tsx frontend/src/accounts.test.ts
git commit -m "feat(frontend): add Buffer sync button, channel badges, and integrations card"
```
