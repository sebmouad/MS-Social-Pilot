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
| Publication failure; connection expired | onPublishFailure | Open |
| Token approaching expiry | onTokenExpiry | Open |
| Approval request | onApprovalRequest | Open |
| Approval decision (author only) | onApprovalDecision | Open |
| Hourly inbox digest | onNewInbox (default off) | Open |
| Empty queue transition | onQueueEmpty | Open |
| Draft updated (author only) | onDraftUpdated | Open |
| Moderation match; negative comment spike | onModerationAlert | Open |
| Internal note mention | onNoteMention | Existing durable intent/email |
| Content mix dry | onQueueEmpty | Existing durable intent/email |

Root installation incidents in `src/lib/system-alerts.ts` (worker, publication
failure aggregate, disconnected/expiring accounts, disk, backups and provider
usage) are a distinct private operator workflow. They must not be exposed as
ordinary member notifications or leak installation diagnostics into a workspace.

### Integration blocker outside this branch's file ownership

`prisma/migrations/20261018150000_rebuild_notifications/migration.sql` defines
both a kind allowlist CHECK (only `note_mention`, `mix_dry`) and a context-shape
CHECK restricted to those kinds. New event types cannot be inserted by changing
TypeScript alone. Do not overload existing kinds or bypass these constraints.
An additive migration must expand both constraints, define durable context
references for connection/inbox incidents, and preserve current tenant/resource
checks. No migration was written or applied in this branch.

The subsequent integration batch must connect transaction-bound producers in
Publishing, Inbox and connection lifecycle services; extend enqueue validation,
resource locks, recipient eligibility and localized event/mail copy; resolve
recipients with current role/feature/resource access; apply the corresponding
personal switch and channel mute; and keep the existing idempotency, retry and
uncertain-hold delivery semantics. Approval/draft decisions must remain author
only; connection repair alerts admin/owner only; inbox digests need bounded
transactional cursor claims. All of these producers are outside the explicitly
owned paths. Full remaining-alert parity is therefore **incomplete**.

No Root keys added. New tests cover independent switches, strict input validation
and English/French label coverage. Targeted notification tests, SQL guard and
TypeScript are local evidence only; no server, database, browser, SMTP or provider
verification was run for these preference changes.
