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
