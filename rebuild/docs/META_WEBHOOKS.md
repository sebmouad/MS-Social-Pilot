# Meta inbound webhooks

Facebook-owned. Meta delivers Page feed, comment and message events to
`POST /api/platforms/facebook/webhooks`; the endpoint is verified once with
`GET` carrying Meta's `hub.mode` challenge. No other provider implements
inbound webhooks yet, so every other platform answers `404`.

Status: source/unit evidence only (mocked signature, parse, ingest and
transport checks in `tests/meta-webhooks.test.ts`). No live Meta delivery
or subscription run is recorded here.

## Secrets and verification

- `POST` bodies are verified with `X-Hub-Signature-256` (`sha256=<hex
  HMAC-SHA256>` of the raw body keyed with the existing `meta.appSecret`).
  The comparison is constant-time; anything else answers `401` and stores
  nothing. Without an app secret every delivery answers `503`.
- `GET` echoes the challenge only for the exact Root secret
  `meta.webhookVerifyToken` (encrypted at rest, never returned by the
  configuration API). Anything else answers `403`; without the token every
  handshake is refused. Enter the same value in the Meta app dashboard
  webhook subscription.
- Both routes share the `security.apiRequestsPerMinute` per-address budget
  with the other provider-signed callbacks (`429` with `retry-after`).
- Bodies beyond 1 MB and batches beyond 50 entries (100 changes/messages
  each) are refused with `400`.

## Ingestion

- Verified events resolve against stored targets, posts and threads only.
  No provider request is ever made here: anything unresolvable is recorded
  as unmatched, never guessed.
- Feed post adds update `external_posts` (message and fetch time only;
  stored insights are never clobbered). Feed comment adds update
  `post_comments` only when the commented post is one of the workspace's
  published posts (matched by `post_targets.remotePostId`). Visitor
  messages append to the existing conversation only when exactly one
  thread on the channel already holds the sender; Page-sent echoes,
  textless events and ambiguous threads wait for the next sync.
- One delivery fans out to every enabled, non-suspended workspace holding
  the Page (at most 50 channels); each channel write uses the existing
  natural keys, so retries converge instead of duplicating.
- Every verified event ends in exactly one content-free receipt row in
  `meta_webhook_deliveries`: ids, kinds, verbs and counts only, never
  message text. Retried deliveries are detected by their stable event id
  and counted as duplicates without rewriting stores.
- `meta.webhooksEnabled` (default on) pauses ingestion: deliveries are
  still verified and recorded, but as ignored without storing. Switching
  the Facebook module itself off does not change webhook behavior; each
  event still resolves only against eligible stored targets.

## Diagnostics and retention

- Root, Facebook platform page, "Meta webhook deliveries" panel: the 50
  most recent receipts (time, Page, event, outcome, matched channels,
  change/count detail), in English and French from
  `meta.webhookDeliveriesCopy`. Platforms without inbound webhooks omit
  the panel.
- Receipts older than `meta.webhookDeliveryRetentionDays` (default 30)
  are purged in bounded batches by the worker inbox job; the purge never
  fails the sync.

## Roles and limits

- Configuration and diagnostics are Root-only. Workspace members,
  integrations and API keys cannot see receipts, tokens or signatures;
  the v1 `webhooks` family manages outbound subscriptions only.
- Webhooks make stored data fresher between syncs; they do not replace
  sync (unmatched events, echoes and disabled reception all wait for the
  next sync, and sync remains the source of insights and presence).
