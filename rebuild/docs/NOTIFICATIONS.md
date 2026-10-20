# Notifications: batch 73

Settings owns personal in-app notifications and queued email delivery. Publishing
emits internal-note mention and content-mix dry events through transaction-bound
ports. This is the initial two-event implementation, not complete legacy alert
coverage or a production release claim.

## Current evidence

The guarded `scripts/verify-notifications.ts` completed against the isolated local
preview on 2026-10-18. Actual HTTP, workspace MCP, PostgreSQL and loopback SMTP
checks cover atomic note/mention persistence, event-recipient idempotency,
personal visibility and mutation refusals, recipient-owned MCP list/read, email opt-out retaining in-app alerts,
exact confirmations, redaction after resource access loss, Root feature-off
refusals, successful delivery without resend, and expired sending claims held
uncertain. Synthetic fixtures and mail/audit rows were removed; captured Root
settings, including the encrypted SMTP secret, were restored exactly.

The additive notification migration was applied only to the loopback preview
after a fresh private backup, scratch restore and scratch migration. Legacy
counts and the settings checksum matched before and after. Migration SHA-256:
`b60b92752dc3019e15156f1ecb4cb58d29b5de4a6676dd141ac13a955277b067`.
This is not a production-shaped migration or rollback rehearsal.

## Remaining release work

- Verify preflight-defer and every delivery failure transition under concurrency;
  claim, result, cancellation, retry, expiry and retention audits now exist.
  The local probe verifies claim/sent/uncertain audits and atomic retention audit.
- Verify dry-mix event production and real
  PostgreSQL delivery/authorization concurrency beyond the current probe.
- Complete browser mutation/retry/all-theme checks; desktop rendering, phone
  review/keyboard and temporary Nightfall rendering were inspected.
  Isolated 2,209 tests / 283 files, production build and serial typecheck passed.
- Run a production-shaped nine-migration rehearsal; checksum-pinned allowlist,
  existing-object/history refusals and mapped-column checks are registered.
- Keep unrelated unfinished module slices and the unused legacy notification
  form excluded from this batch.

Production remains legacy. No external email or provider publication was used
by this synthetic notification verifier.

## Legacy alert comparison and personal preferences (2026-10-20)

This branch adds personal preference persistence, HTTP/MCP schema coverage and
English/French controls for the remaining legacy workspace switches. All writes
use the existing current-authority transaction, personal/workspace scope and audit.
The hourly inbox digest remains opt-in. Its cursor resets only when that switch
actually changes, not when an unrelated preference is edited. Existing queue mutes
remain unchanged. These preferences do **not** enable additional delivery yet;
the UI states that limitation.

| Legacy producer (`src/lib/email/notify.ts`) | Personal switch | Durable rebuild production/delivery |
| --- | --- | --- |
| Publication failure; connection expired | onPublishFailure | Implemented; runtime verification open |
| Token approaching expiry | onTokenExpiry | Implemented; runtime verification open |
| Approval request | onApprovalRequest | Implemented; runtime verification open |
| Approval decision (author only) | onApprovalDecision | Implemented; runtime verification open |
| Hourly inbox digest | onNewInbox (default off) | Implemented; runtime verification open |
| Empty queue transition | onQueueEmpty | Implemented; runtime verification open |
| Draft updated (author only) | onDraftUpdated | Implemented; runtime verification open |
| Moderation match; negative comment spike | onModerationAlert | Implemented; runtime verification open |
| Internal note mention | onNoteMention | Existing durable intent/email |
| Content mix dry | onQueueEmpty | Existing durable intent/email |

Root installation incidents in `src/lib/system-alerts.ts` (worker, publication
failure aggregate, disconnected/expiring accounts, disk, backups and provider
usage) are a distinct private operator workflow. They must not be exposed as
ordinary member notifications or leak installation diagnostics into a workspace.

## Alert delivery integration (2026-10-20)

The preceding preference-only snapshot is superseded for source implementation.
Publishing now emits transaction-bound failure, approval request/decision,
author-only draft-change and empty-queue intents. The Inbox worker emits
moderation-match alerts, opt-in hourly personal digests (bounded, skip-locked
cursor claims) and negative spikes from existing classified sentiment. The
notification worker scans a bounded rotating account slice for revoked/expired
and approaching-expiry credentials. Connection alerts are admin/owner-only.
All use Settings' durable intent service, recipient/event idempotency and existing
email retry/uncertain-hold delivery, with current feature/resource authorization
at enqueue, listing and delivery. Preferences control email; in-app alerts remain.
Channel mutes apply to failure, inbox and queue events. New events have English
and French copy; existing saved Root copy documents obtain additive defaults.

Migration `20261028100000_rebuild_alert_delivery` expands kind/context CHECKs
and adds a cascading connection reference. It is additive and **not applied**.
No credential content, provider error text or comment/post content is copied to
alerts. Private Root installation incidents remain separate. Legacy member
alert inventory has no Ads/report alert type; their own workflows are unchanged.

Root keys (Settings-owned): `notifications.connectionWarningDays` and
`notifications.connectionScanBatch`. The internal rotating scan cursor is stored
as `notifications.connectionScanCursor`; it is operational state, not a Root key.

Open: no rebuild sentiment classifier exists, so unclassified comments cannot
produce negative spikes. Database migration/concurrency, SMTP, browser and live
provider verification remain outstanding. Local mocked producer/service tests,
SQL guard and TypeScript checks do not establish those runtime outcomes.

Branch verification: 148 tests / 17 targeted files passed, including the raw SQL
void guard; `npx tsc --noEmit -p .` passed. An additional module-manifest suite
has a pre-existing unrelated Analytics route expectation failure: it omits
`/analytics/posts`. No build, server, database migration or live probe was run.
