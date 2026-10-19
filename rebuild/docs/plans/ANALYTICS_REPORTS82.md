# Analytics Reports host integration — batch82

Required target remains the full architecture contract. This batch integrates
existing report workflows into the replacement host; it is not whole-app or
full legacy-report parity by itself.

## Ownership

- Claude account1: modules/analytics/reports/** and report module tests. Harden
  authority, actor ceilings, durable claims/recipient intents and unknown outcomes;
  preserve public result shapes. No UI, host, migration, production or DB writes.
- Lower-cost UI agent: app/analytics/reports/{page,ReportsManager,workflows styles},
  isolated component tests. Reuse established primitives/tokens/UX contracts;
  sidebar actions/paging, accessible preserved-input forms and honest statuses.
- Parent: host registration, HTTP/MCP wiring/policy/resources, manifests, Root
  registry/jobs/mail assembly, migration/backup/restore/rehearsal, actual local
  API/MCP/SMTP/browser probe, final review and exact main publication.

## Behavioral and release requirements

Templates are workspace-wide; selected-resource keys cannot read or mutate them.
Channel schedules/history/generation intersect fresh membership + independent
key channel ceilings. Read-only keys cannot write or see manager-only recipients.
Current connection/provider selection applies to content and schedule choices.
No code may convert empty ceilings into all. Shared services own domain rules.

Run-now is a download, never an email; its completed status must say Prepared.
Email delivery needs current owner qualification and author authority, a current
selected channel, validated recipients, durable per-recipient intent/receipt,
lease ownership and fail-closed unknown outcomes. No blind replay/resend after
an ambiguous SMTP result or expired delivery lease. Current suspension/purge
and revocation must be rechecked at boundaries. Do not nest pooled transactions.
All changes/audits should commit together where a local transaction permits.

Root owns report bounds, scheduling policy and safe copy via typed module config.
The host supplies shared Analytics generation + transactional-mail ports and a
separate manifest-declared report job; it does not embed provider metric rules.
Missing SMTP or generation capability must not appear as an active working send.
Existing stored templates/schedules remain manageable without delivery readiness.
Do not offer unsupported report sections on new templates; preserve legacy stored
section choices honestly. Goals/responseTime/destinations/topPosts and AI recap
still require explicit implementation and proof before full parity is claimed.

Add report_runs only. Preserve report_templates/report_schedules, recipients,
aiRecap and all old table contents. Fresh private backup, restored scratch apply,
old counts/content checks and reviewed checksum precede local migration. Extend
cutover schema proof; production-shaped data/media/service rollback remains open.
No production or live-provider writes in this batch.

## Verification

Meaningful failing regressions, module tests, actual PostgreSQL claims/locks/
rollback, isolated full suite + build + serial typecheck. Guarded local HTTP/MCP
and SMTP capture with deterministic example data, sibling/foreign/read-only/empty
scope refusals, exact write confirmations, no duplicate sends, safe uncertainty,
export/erasure and exact cleanup/restoration. Desktop and phone, light/dark,
keyboard/dialog/failure recovery. Independent review, current documentation,
commit main and verify remote exact SHA. Full rebuild goal stays active.

## Verified closure —2026-10-19

Final isolated candidate:2865 tests/331 files, zero skips; production build and
serial typecheck.9 actual PostgreSQL cases prove claims/audit/FK/purge behavior
and live writer, retention and stale-sweep races against erasure. Both Claude
accounts reviewed; actionable lease, replay, retention/lock-order and delivery
state findings were corrected with regressions and post-change checks.
Actual localhost HTTP/MCP/Chromium/ZIP export/erasure and disposable-schema SMTP
capture passed after corrections. All probe fixtures/settings cleaned/restored;
insert-only persistent preview examples seeded twice separately.17-file
schema-only migration rehearsal passed; production-shaped release gates remain.

The batch closes its workflow integration scope. The full rebuild stays active:
remaining report sections/AI recap, full Facebook adapter coverage, other legacy
integrations, whole-app UX/Root coverage and production-shaped migration/media/
single-publisher/service rollback still require work. See REPORT_WORKFLOWS.md
and current shared handoff. No production/provider write or cutover occurred.
