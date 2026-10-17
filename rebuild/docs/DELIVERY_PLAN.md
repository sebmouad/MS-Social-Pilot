# Shared delivery plan

Updated: 2026-10-17. Goal: [GOAL.md](GOAL.md). Required architecture:
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md). Current source/evidence:
[ARCHITECTURE.md](ARCHITECTURE.md), [PREVIEW_QA.md](PREVIEW_QA.md).

## Working order

Deliver larger complete user flows using independent lower-cost agents, explicit
file ownership, one integration review and appropriate automated/live checks.
Avoid spending successive batches polishing the same narrow boundary while
major customer capabilities remain missing. Safety and cutover requirements stay
in force. Commit verified batches on `main`, push to `origin/main`, and verify
the exact remote revision before ending a session.

### 1. Complete core onboarding and finish the current layout repair

- Fix and verify the observed phone module-rail overflow, including open dialogs,
  native selection, table access, the single navigation drawer and all four themes.
- Build Root-managed transactional mail with secure credentials, truthful delivery
  outcomes and diagnostics; customer screens expose usable actions only.
- Complete workspace invitations: create, list, reissue, expire, revoke and accept;
  hashed one-time tokens, current inviter authority, explicit role/channel effects,
  atomic membership/audit and shared UI/API/MCP management services.
- Complete invitation-bound new-account onboarding, existing-account sign-in and
  account recovery/verification. Reuse normal two-factor/passkey policy; an
  invitation must never authenticate an existing account or bypass its factors.
- Validate expiry, replay, disabled users, wrong recipient, permission changes,
  delivery failure and cross-workspace denial. Use reserved synthetic recipients
  and isolated local mail capture before authorized real delivery tests.

Batch 62 implements invitations, transactional mail and invitation-bound registration.
General verification/recovery and phone/browser acceptance remain open.

### 2. Complete customer modules against the full parity inventory

- Publishing: remaining queue/composer/media/import/approval/template workflows,
  native provider formats, first-comment outcomes, scheduling and reconciliation.
- Inbox: complete discovery and reply/moderation workflows, assignment, notes,
  saved replies, history and honest provider coverage.
- Analytics: every readable metric, breakdown and audience snapshot, correct
  aggregation/provenance, complete exploration, comparison and export.
- Ads: full supported account/object reporting, creation, creative, budget,
  delivery/status and deletion workflows with explicit spending confirmations.
- Settings and Root: full account, workspace, module, connection, entitlement,
  plan, data lifecycle, operational, diagnostic and configuration coverage.
- Restore every useful legacy capability, including secondary workflows recorded
  in LEGACY_CAPABILITY_PARITY.md. This list does not replace that inventory.

Each capability includes the customer experience, shared service, API/MCP parity,
current permission/resource checks, failures, audit and appropriate live evidence.
Do not advertise adapter sub-operations before those paths actually work.

### 3. Finish the Facebook engine and live proof

Keep provider implementation entirely inside its module. Complete OAuth/token
lifecycle, discovery, publication formats/status/deletion, inbox, metrics and Ads
operations supported by the shipped scope. Keep shared products provider-neutral.
Resolve the held live media-cleanup evidence before another canary on the same
Page. No unknown write may be blindly repeated. Verify real outcomes and remove
identifiable test content. Current live evidence is narrower than the complete
rebuild runtime; see FACEBOOK_LIVE_MEDIA_CANARY.md.

Instagram is the user's chosen next provider, after core design and Facebook.
Other platforms remain separate future modules; do not scatter their logic into
shared services or expose unavailable features.

### 4. Release rehearsal and production cutover

Follow CUTOVER.md for the exact release: capability/authorization/browser/live
checks, production-shaped migration, data/media/permission reconciliation,
restorable backup, tested service/proxy/data rollback, single publisher, then
rebuild deployment and observed production health/workflows. Keep legacy running
until every gate passes. Do not treat a legacy deployment as rebuild delivery.

## Evidence discipline

Record source implementation, unit/integration evidence, browser evidence, live
provider evidence and production evidence separately. Update affected documents
with each batch, including unresolved issues. The current percentage estimates
are planning judgment, not a measured release score or acceptance criterion.

See AGENT_HANDOFF.md for the latest verified batch and immediate continuation.

## Five-hour delivery window requested on 2026-10-17

The user requested merging all substantial legacy functionality within this
session. Working window recorded at 2026-10-17 22:36:43 UTC, ending
2026-10-18 03:36:43 UTC (04:36:43 Africa/Casablanca). Prioritize broad complete
workflows, parallel ownership, working GitHub commits and explicit parity gaps.
This deadline does not weaken verification or production cutover requirements,
and is not a claim that every legacy capability can be completed in that window.

## Ten queued parallel workstreams

The current executor supports three simultaneous subagents plus the lead.
Rotate workers across this queue; ten simultaneous subagents are unavailable.
Each handoff must name owned files and shared integration points.

| Queue | Workstream | Current state |
| --- | --- | --- |
| 1 | Mail, invitations and account onboarding | Batch 62 published; recovery implementation in review |
| 2 | Publishing templates and composer reuse | Batch 63 verified; runtime probe pending |
| 3 | Inbox assignment, private notes and saved replies | Batch 63 verified; runtime probe pending |
| 4 | Workspace operational settings and runtime rules | Time zone/approval subset verified in batch 63 |
| 5 | Publishing labels, custom fields, notes, versions and bulk workflows | Queued |
| 6 | Client review/share links and public bio workflows | Queued |
| 7 | Analytics explorer, demographics, pinned metrics and complete reports | Queued |
| 8 | Complete Ads legacy reporting and management workflows | Queued |
| 9 | Root plans, privileges, lifecycle, errors and backup operations | Queued |
| 10 | Remaining legacy services: notifications, webhooks, REST/OAuth, agency, feeds, tasks and media | Queued; split into reviewable capabilities |

This queue organizes delivery and does not replace the complete legacy inventory
or omit account recovery, provider formats, data/rollback and release gates.

Claude Code Sonnet delegation is now available after user sign-in. Its first
labels slice is in independent review. A separate coordinator is rotating up to
four Claude workers through the remaining inventory; exact non-overlapping
ownership is in CLAUDE_PARITY_COORDINATION.md. Lead retains integration, checks
and publication. Queue state is implementation work, not verified completion.

## Delegation continuity after first-account limits

First Claude account delivered W1-W4 source handoffs; later-wave files were
interrupted by its session cap. Codex worker credits were exhausted as well.
At the user's explicit request, an isolated second Claude account was verified
and its coordinator launched four review/fix workers over W1-W4. It will then
resume incomplete Analytics, agency/tasks, feeds/AI/media, integrations and
Facebook formats. See CLAUDE_ACCOUNT2_COORDINATION.md for exact ownership.
Lead retains central integration and Git publication. No partial worker result
is a release claim, and production remains legacy.


## Batch 65 — private Root operations

Registry 60 integrates Root-owned plan controls, privilege directory/complete-or-refused CSV, account/workspace lifecycle inspection and ownership transfer, redacted error management, and recorded backup/diagnostic summaries. UI/API/installation MCP use shared current-authority services; workspace roles and API keys cannot grant Root. Mutations serialize affected accounts/workspaces and audit atomically. Filters and CSV controls occupy the existing contextual sidebar.

The guarded local `scripts/verify-root-operations.ts` passed actual HTTP/MCP/PostgreSQL operations, authorization refusals, confirmations, persisted outcomes and exact fixture/configuration cleanup. Desktop Chrome verified the privilege page and contextual filters. These checks do not prove phone/theme mutation flows, archive restoration, live provider capability or production readiness. Backup records report recorded status only. Production remains legacy; parallel Claude source slices are unfinished integration work and must not be included in this batch.


## Batch 66 — Publishing collaboration source foundation

The Publishing-owned collaboration slice is preserved in version control with service, HTTP, UI and MCP metadata source for bulk label assignments, custom fields, internal notes/mentions, versions, queue times, content mix and recycling. It is NOT host-integrated or release-ready: its Root settings are not registered, customer navigation/MCP host registration and publishing lifecycle/worker ports remain unconnected. Do not report these capabilities as delivered to customers.

Lead review removed fail-open worker eligibility and per-run cached workspace grants. Missing owner-qualification callbacks now refuse before reads; each recycle item requires a fresh eligibility check. Three failing regressions establish the original bug; 68 focused mocked tests pass after the fix. Typecheck and production build passed the isolated source snapshot. Remaining security/integration gaps are explicit in PUBLISHING_COLLABORATION.md, including transaction-boundary checks, recycled-variant approval, destination authority, version hooks and PostgreSQL/browser/MCP proof. Continue integration; do not enable ports from metadata alone.
