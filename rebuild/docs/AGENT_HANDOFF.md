# Codex and Claude project memory / handoff

Updated: 2026-10-18. This is durable project context, not proof of current runtime
state. Recheck Git, code and external state before acting. Never copy credentials,
session tokens, private environment contents, customer records or raw logs here.

## Canonical context

- Goal remains active: [GOAL.md](GOAL.md).
- User-approved target: [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md).
- Current implementation: [ARCHITECTURE.md](ARCHITECTURE.md).
- Work order: [DELIVERY_PLAN.md](DELIVERY_PLAN.md).
- Design and behavior: [../DESIGN.md](../DESIGN.md), [../UX-CONTRACT.md](../UX-CONTRACT.md).
- Capability and release gates: [LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md), [CUTOVER.md](CUTOVER.md).

## Accepted decisions to preserve

- Fresh replacement in `rebuild/`; old routes, icons and workflows need not survive.
  Preserve useful capabilities and needed data; obsolete data requires backup and
  verification before removal.
- Private Root manages every module. Product and platform implementation stays in
  self-contained module folders; shared infrastructure stays provider-neutral.
- Facebook first. Everything provider-specific belongs in its adapter/module.
  Instagram follows after core design and Facebook; other providers ship later.
- Two left sidebars, no third menu. Contextual navigation, filters and pickers live
  in the second sidebar; phones use the accessible shared drawer.
- Posts defaults to Table with Feed/Cards available. One branded system with Grove,
  Coast, Clay and Nightfall themes; customer UI contains no operator setup jargon.
- Discovery adds only checkbox-selected channels/ad accounts. Disconnect asks to
  retain or delete related data. Published-post deletion offers remote deletion
  and reports actual per-destination status and uncertain/partial effects.
- Analytics exploits every readable metric; audience sums selected eligible channels
  with coverage and freshness, without implying deduplicated unique people.
- Root owns typed, validated, versioned configuration and diagnostics. UI/API/MCP
  share current permissions, tenant scope, confirmations and application services.
- Automatic sync qualifies through any active owner's plan/access by default;
  the same owner must grant both product feature and platform access.
- Real API/settings/test-content checks and deployment are authorized. Use
  identifiable records, verify remote outcomes, clean up, and keep release gates.
- Local previews use realistic synthetic examples. Keep provider/live evidence
  distinct. Publish completed work to GitHub before the session ends.
- User requested faster, larger feature batches and lower-cost parallel agents.
  Assign independent files, integrate once and avoid repeated narrow polishing.

## Current verified baseline

GitHub main was verified at `1f09d25262d3158a6ed626803ce72bf215ab5ee8`.
Batch 75 delivered durable paused Ads creation/recovery. Batch 76 integrated
Tasks. Batch 78 fixes independent Claude review findings in guarded erasure and
Tasks transaction nesting. Root registry is 69 in that published baseline.

The batch-78 isolated snapshot passed 2,435 tests / 299 files, zero skips,
production build and serial typecheck. Six separate real PostgreSQL tests passed
single-connection Tasks writes, checklist/comment, concurrent optimistic updates
and purge refusal. The feed-erasure PostgreSQL regression reproduces the old
55000 failure and proves dependency ordering preserves foreign records. Actual
local HTTP/MCP/export/erasure workflow passed with exact settings restoration and
verified synthetic cleanup. See AGENCY_TASKS.md and CUTOVER.md for limits.

## Latest verified batch: Agency integration (77)

Both authorized Claude accounts completed separate Sonnet batches. Account 1
implemented/refined Agency module/UI/API; account 2 reviewed Tasks and built its
fixes/concurrency tests, then the Agency verification probe. No worker is assumed
live; revalidate handles before continuing. Credits were refilled and the earlier
approval blocker cleared. Private CLI profiles/logs stay outside Git.

Agency is registered with module/feature permissions, Root registry 70 (nine
bounds/weights), grouped plan controls, two-sidebar navigation and workspace-switch
actions. Per-workspace and metric-group authority is current; unavailable counts
are withheld with coverage. Workspace-name search cannot infer client identities.
Anonymous API requests return 401; installation policy applies to suspended rows.
Agency MCP tools remain absent from workspace/installation catalogs: no workspace
credential may expand into person-wide access. Full MCP parity remains open.

Exact isolated batch passed 2,490 tests / 305 files, zero skips, production build
and subsequent serial typecheck. Actual localhost production-build HTTP/MCP/
PostgreSQL and hydrated Chromium probe passed tenant reads, current policy,
foreign/key refusals, pages and workspace selection. Disposable records/audits
were removed; captured Root settings were restored exactly. Chrome separately
verified desktop two sidebars, 390px phone width/local table scrolling, sidebar
search/reset, Escape focus return and offline error followed by online retry.
Four theme renderings changed actual computed colors without overflow; restored
Grove. This is not full all-theme accessibility or production deployment proof.
See AGENCY.md for performance, pagination, concurrency, write/MCP and release gaps.

Earlier probe failures drove actual auth/policy fixes. Raw streamed HTML parsing
also produced invalid assertions; final page checks use hydrated Chromium DOM.
The verification script's exact Playwright development dependency is locked.
A typed probe assertion was corrected before final build/typecheck/probe pass.

Untracked sharing, feeds/AI/media, report workflows, integrations and Facebook
native slices remain unfinished and excluded. Preserve and integrate independent
batches; never broad-stage unrelated source. Production remains legacy.

## Next delivery order

1. Verify the latest Agency main commit and preserve its evidence/limitations.
2. Integrate remaining sharing/bio, feeds/AI/media, reports and developer
   integrations against the full legacy inventory with current shared authority.
3. Complete Facebook native formats and full live publishing/inbox/analytics/Ads
   coverage; adapters own every provider-specific rule and UI schema.
4. Close Root configuration, diagnostic, permission and MCP coverage gaps;
   person-wide Agency MCP credentials are not implemented. Existing workspace
   credentials must stay workspace-scoped.
5. Rehearse production-shaped customer data/media migration and exact service
   rollback, then satisfy every release gate before production cutover.

## Runtime and safety facts to revalidate

- Local preview must use realistic synthetic examples in a guarded loopback
  `_preview` database. No credentials, private environment contents, raw logs or
  customer records belong in Git. Four Tasks examples intentionally remain.
- Production and `socialpilot-deploy` still run legacy. Passing local tests does
  not authorize claiming production readiness or completed legacy parity.
- Thirteen pinned migrations passed schema-only rehearsal; customer-data/media/
  service rollback remains unproven. Existing migrations must not be rewritten.
- The Facebook Cuisine Pleine d’Envie multi-photo canary still has held photo
  cleanup despite a feed-delete receipt. Preserve the private ledger and Page
  lock. Unreadable objects do not prove deletion. No blind retry or new canary on
  that Page. See FACEBOOK_LIVE_MEDIA_CANARY.md.
- Ads provider writes lack complete live permission/coverage proof. Do not
  advertise unverified suboperations. Root switches alone do not implement APIs.
- Percent estimates are subjective, not test-derived. No fresh overall completion
  percentage is established by this handoff. Full objective remains active.

Update this file in place with current facts; Git preserves historical handoffs.
Do not append contradictory old baselines or shrink the target to implemented work.

## In-progress batch 79: client sharing and bio

Published baseline is now `bab6fce4738449ac8bb951cd422af2752c846c60` (Agency),
verified on GitHub main. Current uncommitted Sharing source is NOT release-ready.
Account 1 owns sharing module/UI/API/tests; account 2 completed security review
and neutral Publishing review-participant source/tests, then started a real-PG
participant test. Parent owns Settings manifest/features, Root registry 71, MCP
host/resources, migrations and verification. Inspect handles rather than assuming
workers remain live. Their own test commands are routinely denied; parent runs
actual tests. No production/provider operation belongs to this batch.

Local additive migration `20261018230000_rebuild_sharing_expiry` is already applied
after a fresh private backup, scratch restore/migration and checks preserving
104 original table counts, exact settings and original share-link contents.
SHA256: `28d4f9da65ed866f6139aa982d4756906cd329080dccf6cf2d87dee32e59d263`.
Do not edit/replay it. Root Prisma ShareLink declares nullable expiresAt; schema
validation passed. All fourteen pinned migrations passed schema-only rehearsal;
eleven cutover safety tests passed. This is NOT customer-data/media rollback proof.

Neutral reviewPost participant callbacks join the existing publishing transaction
without Sharing-specific rules. The isolated foundation passed 2,509 tests / 307 files, zero skips, production
build and serial typecheck. Five actual PostgreSQL participant tests prove local
approval/feedback rollback and competing-review outcomes; outer authority ports
are stubbed, so these are transaction proofs, not full public Sharing evidence.
An initial fixture run used models absent from the thin rebuild Prisma client;
five exact orphan synthetic fixtures were subsequently removed and verified.
The corrected SQL-based fixture tests pass with cleanup. Actual Sharing flow
integration remains pending.
The independently reviewed Sharing defects include draft leakage, long-note
approval fallback, non-atomic decision/approval, nested transactions, public rate
limiter isolation/unknown-address behavior, bio current entitlement, unique-error
mapping, media previews and MCP feature/resource/result ceilings. Do not expose
public routes from mere host registration before these are addressed and verified.

The local production-build preview now serves the verified review foundation
from its isolated snapshot on localhost:3200; it does NOT include unverified
Sharing source. One build started in the wrong preview directory was stopped
and rerun in the correct snapshot before restoration. Production was untouched.
Account1 Sharing implementation handle was 93328 at this checkpoint; re-poll
that handle before dispatching overlapping module edits. Account2 PG worker is
terminal. Private source handoffs stay outside Git; ownership remains as above.
