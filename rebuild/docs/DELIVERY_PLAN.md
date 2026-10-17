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

These are planned deliverables. Batch 61 implements existing-account team
management only; invitations, mail and registration are not implemented yet.

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
