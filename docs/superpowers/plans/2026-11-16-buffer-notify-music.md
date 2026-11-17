# Buffer Notify Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automation Buffer sends schedule a notification post for +30 minutes and Telegram tells the operator to add TikTok music before publishing.

**Architecture:** Thread `schedulingType` through `PublishPostRequest` into `BufferPublisherAdapter`. The Buffer branch of `dispatchCarouselRun` always schedules `now+30m` with `notification`. Update the `buffer_accepted` Telegram template.

**Tech Stack:** TypeScript, Node test runner (`tsx --test`), Buffer GraphQL `createPost`.

**Spec:** `docs/superpowers/specs/2026-11-16-buffer-notify-music-design.md`

## Global Constraints

- Buffer music path uses `schedulingType: "notification"` and `mode: "customScheduled"` with `dueAt = now + 30 minutes` — never `shareNow` / `automatic` for `channel: "buffer"` dispatch.
- Telegram copy (exact): `📤 No Buffer em ~30min — @<conta> — abre o Buffer, adiciona a música e publica`
- Do not change PostForMe stub, Telegram album dispatch, or polling `internal_pending` publish mode.
- Default `schedulingType` remains `"automatic"` when omitted (non-Buffer-automation callers).

## Review Focus

- Manual gallery Buffer dispatch sharing the same branch gets +30m notification — expected and acceptable.
- `scheduledAt` must be ISO-8601 UTC; adapter must send it as `dueAt`.
- Notification posts may stay `queued` until the human publishes — polling/`publish_ok` must still work when status becomes sent.
- Social/`postforme` channel must keep previous immediate behavior.
- Approval still notifies `buffer_accepted` with the new copy after successful Buffer accept.

## File map

- Modify: `backend/src/domain/social/types.ts` — add `schedulingType?`
- Modify: `backend/src/domain/social/providers/buffer.ts` — pass `schedulingType`
- Modify: `backend/src/domain/dispatch/service.ts` — Buffer branch schedule +30m notification
- Modify: `backend/src/domain/automation/notifications.ts` — `buffer_accepted` copy
- Test: `backend/tests/social/buffer.test.ts`
- Test: `backend/tests/dispatch/social-dispatch.test.ts`
- Test: `backend/tests/automation/notifications.test.ts`

---

### Task 1: Buffer adapter `schedulingType`

**WDD class:** dense

**Files:**
- Modify: `backend/src/domain/social/types.ts`
- Modify: `backend/src/domain/social/providers/buffer.ts`
- Test: `backend/tests/social/buffer.test.ts`

**Interfaces:**
- Consumes: existing `PublishPostRequest`
- Produces: `PublishPostRequest.schedulingType?: "automatic" | "notification"`; adapter sets GraphQL `input.schedulingType` from request or `"automatic"`

- [ ] **Step 1: Write failing test** `maps schedulingType notification + scheduled mode to customScheduled with dueAt`

Assert `capturedBody.variables.input` includes `schedulingType: "notification"`, `mode: "customScheduled"`, `dueAt` equal to the request `scheduledAt`, and carousel `assets`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL= NODE_ENV=test tsx --test --test-concurrency=1 tests/social/buffer.test.ts`
Expected: FAIL (missing `schedulingType` on input or type)

- [ ] **Step 3: Add `schedulingType?: "automatic" | "notification"` to `PublishPostRequest`; in `publishPost`, set `input.schedulingType = request.schedulingType ?? "automatic"`**

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/social/types.ts backend/src/domain/social/providers/buffer.ts backend/tests/social/buffer.test.ts
git commit -m "$(cat <<'EOF'
feat(buffer): pass schedulingType through createPost

EOF
)"
```

---

### Task 2: Dispatch Buffer as +30m notification

**WDD class:** dense

**Files:**
- Modify: `backend/src/domain/dispatch/service.ts`
- Test: `backend/tests/dispatch/social-dispatch.test.ts`

**Interfaces:**
- Consumes: Task 1 `PublishPostRequest.schedulingType`
- Produces: for `options.channel === "buffer"`, `publishPost` called with `publishMode: "scheduled"`, `scheduledAt: <ISO now+30m>`, `schedulingType: "notification"`; `channel === "social"` unchanged (`immediate`, no notification type)

- [ ] **Step 1: Write failing tests**

1. Buffer dispatch: `publishedReq.publishMode === "scheduled"`, `publishedReq.schedulingType === "notification"`, `publishedReq.scheduledAt` within ~2s of `Date.now()+30*60*1000`.
2. Social/existing immediate assertion stays for non-buffer path (keep current immediate test for the social fixture if present; if the suite only covers buffer, add a note that buffer is the changed path and update the old `immediate` expectation).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL= NODE_ENV=test tsx --test --test-concurrency=1 tests/dispatch/social-dispatch.test.ts`
Expected: FAIL on `publishMode` / `schedulingType`

- [ ] **Step 3: In `dispatchCarouselRun` Buffer branch only, pass scheduled +30m notification fields into `provider.publishPost`**

Use `new Date(Date.now() + 30 * 60 * 1000).toISOString()` for `scheduledAt`.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/dispatch/service.ts backend/tests/dispatch/social-dispatch.test.ts
git commit -m "$(cat <<'EOF'
feat(dispatch): schedule Buffer posts +30m as notification

EOF
)"
```

---

### Task 3: Telegram `buffer_accepted` copy

**WDD class:** wiring

**Files:**
- Modify: `backend/src/domain/automation/notifications.ts`
- Test: `backend/tests/automation/notifications.test.ts`

**Interfaces:**
- Consumes: existing `buffer_accepted` event
- Produces: message `📤 No Buffer em ~30min — @${account} — abre o Buffer, adiciona a música e publica`

- [ ] **Step 1: Update failing expectation** in `notifyAutomation sends Portuguese templates` for `buffer_accepted` to the exact new string regex

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL= NODE_ENV=test tsx --test --test-concurrency=1 tests/automation/notifications.test.ts`
Expected: FAIL on string mismatch

- [ ] **Step 3: Change `formatMessage` case `buffer_accepted` to the exact copy above**

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/automation/notifications.ts backend/tests/automation/notifications.test.ts
git commit -m "$(cat <<'EOF'
fix(automation): tell operator to add music after Buffer accept

EOF
)"
```
