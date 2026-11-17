# Buffer notification +30min for TikTok music — Design

**Date:** 2026-11-16  
**Status:** Approved  
**Intent:** Automation Buffer posts must leave room for a human to attach TikTok music before publish.

## Why

TikTok music is not available on Buffer automatic/`shareNow` publishes. Buffer **notification** publishing opens the post in the TikTok app so the operator can add a sound. Telegram already notifies the automation chat; the copy should tell them to open Buffer and add music.

## Goals

- On Buffer send from automation approval, create a Buffer post scheduled **30 minutes from now** with `schedulingType: notification`.
- Telegram `buffer_accepted` tells the operator to open Buffer, add music, and publish.
- Existing approval, slot `done`, and polling → `publish_ok` / `publish_failed` stay.

## Non-goals

- Picking a specific track via API / `auto_add_music` on Buffer.
- Changing PostForMe stub behavior.
- Changing Telegram-channel album dispatch.
- Changing window/planner math.

## Approaches

1. **Chosen — Buffer notification + `dueAt = now+30m` on automation Buffer dispatch.** Matches how Buffer expects music to be added; Telegram is the reminder.
2. Automatic schedule +30m — rejected: auto-publish cannot attach TikTok music.
3. `auto_add_music` on Buffer metadata — rejected: not in Buffer TikTok metadata API.

## Design

- Extend `PublishPostRequest` with optional `schedulingType?: "automatic" | "notification"` (default `"automatic"` for non-Buffer-automation callers).
- `BufferPublisherAdapter.publishPost`: pass `schedulingType` from the request (fallback `automatic`); keep `shareNow` / `customScheduled` from `publishMode`.
- `dispatchCarouselRun` for `channel: "buffer"`: `publishMode: "scheduled"`, `scheduledAt: now+30m` ISO, `schedulingType: "notification"`. Other channels unchanged. Polling `internal_pending` stays `immediate`/`automatic`.
- Telegram `buffer_accepted` copy: `📤 No Buffer em ~30min — @<conta> — abre o Buffer, adiciona a música e publica`.
- Builder calls: exact GraphQL field names Buffer already uses (`schedulingType`, `mode`, `dueAt`).

## Left to builder

- Whether gallery manual Buffer dispatch shares the same +30m notification path (prefer yes if it uses the same `channel: "buffer"` branch — one code path).
- Test placement in existing buffer / dispatch / notifications suites.
