# Codex and Claude project memory / handoff

Updated: 2026-10-19. This is durable project context, not proof of current runtime
state. Recheck Git, code and external state before acting. Never copy credentials,
session tokens, private environment contents, customer records or raw logs here.

Current continuation: batch89 at the end of this document and FACEBOOK_NATIVE_JOURNAL_PLAN.md. Earlier numbered batch sections are historical snapshots; they do not override the latest evidence or remaining gates.

## Historical verified batch —84

Neutral format catalog + legacy intent bridge: typed adapter metadata, safe
per-destination projection with credential-grant narrowing, default validation,
malformed-module isolation and MCP tools/resources. Facebook advertises feed only;
Root `meta.feedFormatLabel` is active, registry75. Thin Prisma now maps existing
Post.format (no migration). Publish preserves it and preflights formats before
any claim; schedule/reschedule/queue/duplicate validate it, duplicates preserve it.
Direct Facebook publishing refuses unknown formats before transport.

Clean candidate:2932 tests/337 files, zero skips with synthetic PostgreSQL;
build/typecheck passed; final MCP140 tests passed. Both Claude accounts reviewed;
preflight/catalog defects fixed. No new UI/browser/live/provider-write evidence.

Next: replace the transitional post-level legacy format bridge with neutral
per-destination intent storage and complete authoring/CSV/template/export/status/
delete/worker/MCP propagation. Current legacy database default remains a documented
compatibility boundary, not future-provider support. Then integrate signed native
transport, tenant-bound durable phases/leases and Root controls with live proof.
Native source stays unavailable. See FACEBOOK_NATIVE_FORMATS.md. No migration or
production cutover occurred; held photo canary remains untouched.

## Current native-format checkpoint —83

Native source and mocked tests are now owned/versioned, still `wired:false`.
Executor checkpoints phase intents and IDs before subsequent remote writes;
malformed finish/Story identities remain uncertain; direct byte-only uploads
are refused; asynchronous video receipts require readback. Status mapping needs
positive publication/schedule evidence. Graph100/sub33 never proves absence or
successful deletion. Numeric metadata and dates fail closed. Both Claude
accounts completed independent read-only reviews; additional final-ID and child-
operation reconciliation defects were corrected. Clean HEAD plus owned source:
2918 tests/336 files, zero skips with guarded local PostgreSQL; typecheck and
production build passed. Native-only tests:53. No new UI/browser/live claims.

No migration or provider write was performed. Do not mistake the proposed
unscoped SQL store for a tenant-bound/fenced production journal. Next remains
full native-format host integration (contracts, storage, Root, UI/API/MCP and
live proof). Preserve the held photo canary and production legacy service.

## Prior verified batch —82 (2026-10-19)

Reports is integrated and locally verified; see REPORT_WORKFLOWS.md. Final
candidate:2865 tests/331 files, zero skips, build/typecheck,9 actual PostgreSQL
cases, real local HTTP/MCP/Chromium/SMTP and ZIP export/erasure. Fresh-claim and
workspace-first maintenance corrections passed post-change checks. Registry74,
two additive report migrations and17-file schema-only rehearsal. Both Claude
accounts reviewed. Production/socialpilot-deploy remain legacy; preserve photo
canary lock. Synthetic Reports examples were inserted twice without replacement.

Next substantial P0 work: Facebook native format engine integration. Existing
formats source is unregistered/unverified, not ready functionality. Add granular
neutral contracts, durable migration/recovery and actual UI/API/MCP/Root paths
only for verified supported operations. Meta developer docs were rate-limited;
research found official Page Reels lifecycle evidence, while current scheduling,
scopes/deletion and Stories need stronger evidence. Do not advertise removed
Groups API. Feeds/AI/media/integrations remain separate unfinished untracked
batches; do not broad-stage. Reports still lacks several legacy sections/AI recap.
Complete Root controls, whole-app UX, provider/live and production-shaped
migration/media/service rollback remain required. Keep the full goal active.

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

### Batch79 continuation checkpoint

The atomic foundation is published and GitHub-verified at
`682ca73ce771f54522ca5a33b04e35e4c50fd35b`. Its isolated production-build preview
is restored on localhost:3200 (Agency visible at 1440px, no horizontal overflow).
Account1 initial implementation handle93328 is terminal. It produced separate
Settings sharing/bio pages, ten MCP definitions, uploaded-image previews and
current owner-bio availability. Parent sharing/host targeted tests passed, but
full feature integration is not yet verified or published.

Account1 hardening handle62189 and account2 verifier handle82970 were confirmed
live at this checkpoint. Do not restart on an observation timeout. Account1 owns
Sharing module/routes/tests; account2 owns only scripts/verify-client-sharing79.ts.
Parent owns shared host and config. Key hardening requirements: compare the
current tokenHash under the feedback/review mutation lock (id/expiry alone do not
stop a rotated token), serialize plain comment/advice writes, keep public limiter
storage separate from login counters, enforce current Publishing feature/key
ceilings before exposing post data, and limit review mode to pending approvals.
No false advice acknowledgment on database/participant failures; keep client
comment bodies out of generic activity logs. Account1 has the full findings.

Remaining uncommitted host work installs Settings pages/Root registry71, Sharing
MCP tools/resources/current permission ceilings and owner-service lock exclusion.
Before exposing it: review completed hardening, run isolated full tests/build/
serial typecheck, actual HTTP/MCP/PG/Chromium verifier and cleanup/export/erasure,
then browser UX with example data and explicit main publication. Do not include
unrelated AI/feeds/sharing-report/native-format source merely because it exists.


## Sharing integration checkpoint — 2026-10-18, follow-up

Both external Claude accounts contributed. Account1 completed Sharing implementation
and hardening before reaching its session quota; account2 completed independent
review, CRUD continuation and capability-minting fixes. These workers are terminal;
do not restart the old handles from the preceding checkpoint.

Current uncommitted Sharing source refuses Settings-only token rotation and requires
current approval write for rotating a deciding link, including renewal/access edits.
API-key domain audits carry key identity without credentials. Parent verification
found and fixed missing-channel validation copy and an inaccurate target fixture.
A millisecond-dependent expiry fixture made optimistic-version tests flaky; its
expiry is now a fixed future instant. All 126 focused tests in six files pass.

Fresh isolated snapshot: /private/tmp/msp79-finalcheck/app. Its production build
passed; full suite passed 2506 tests with 129 database-dependent tests skipped
(285 passing files, 28 skipped). These skips are not database integration proof.
Serial typecheck passed after correcting test schema-union narrowing; all 54
link tests passed again afterward. Earlier actual workflow run still has unresolved
verification failures; source corrections need a rebuilt runtime and fresh complete
HTTP/MCP/PostgreSQL/browser probe before Sharing is published as verified.

Next: finish auth-wrapper and CRUD live assertions, bio confirmation UX, public
phone layout verification, exact cleanup, synthetic examples and documentation.
Sharing source remains uncommitted; unrelated unfinished modules remain excluded.
Production and socialpilot-deploy remain legacy. Preserve the held-photo canary lock.


## Sharing and bio host integration — batch79b

Settings installs /settings/sharing and /settings/bio, Root registry71, eleven
workspace MCP tools and two resources through shared services. Links support
explicit channel selection, expiring hash-only credentials, versioned editing,
confirmed address replacement/renewal, revoke/delete and client feedback. Public
review uses atomic Publishing participation; current role/feature/scope/expiry
checks apply, with streamed request bounds and token comparison under mutation
locks. Bio preserves unchanged link IDs/clicks and rechecks successful public
authority without a positive cache. Generic config-batch reads fail closed.

Fresh isolated candidate passed 2647 tests /314 files (zero skips), production
build and serial typecheck. Actual guarded local HTTP/MCP/PostgreSQL/Chromium
probe passed, including editing/stale refusal/renewal, credential-mint denials,
key audit provenance, oversized feedback, public review and uploaded images,
bio controls, export and erasure. All disposable data/audits/media were removed
and captured Root settings restored exactly. Synthetic example links and bio
were then intentionally seeded separately for local UI review.

Desktop inspection corrected table measure, native form-control overlap and
checkbox sizing; a phone grid fix keeps table overflow local. Settings legacy
button selectors now exempt design-system buttons instead of overriding primary
and danger variants. Final compiled Chrome confirmation passed at desktop1440px and phone390px;
public table overflow remains local, a creation dialog measures352px, and Bio
inputs fit. Temporary Nightfall rendering was inspected and restored to Coast.
Final CSS build and serial typecheck passed. Full all-theme accessibility and
browser save/offline/retry evidence remain open.

MCP manager keys still lack independent channel scopes in the key model; unit
actor ceilings do not prove full end-to-end resource scope. Portal results,
publish-anyway, public workspace logos/email, cross-process rate limiting and
proxy behavior remain open. Full Facebook live coverage/held-photo cleanup,
remaining module integrations, Root coverage, production-shaped migration and
rollback/cutover remain required. Production/socialpilot-deploy remain legacy.
See CLIENT_SHARING.md. Do not broad-stage unrelated unfinished source.


## Batch80 — independent MCP resource ceilings

New keys explicitly select channels and ad accounts independently, or all current
and future selected resources. Shared issuance/revocation and request dispatch
intersect current authority; workspace-wide tools/resources refuse selected keys.
Session feature parity remains unchanged. Root registry72 owns new scope and
transaction bounds. See MCP_RESOURCE_SCOPE.md for semantics, migration and gaps.

Isolated database-enabled suite: 2711 tests/321 files, zero skips. Production build
and serial typecheck passed, including final scoped themed controls. Actual local
HTTP/MCP/PostgreSQL/Chromium probe passed independent issuance, account/channel
isolation, Analytics sibling exclusion, global refusals and revocation; disposable
data/media/audits were removed and exact Root settings restored. Desktop1440px
and phone390px inspection passed scoped layout, with temporary Nightfall restored
to Coast. Independent final Claude review stopped at quota, not a review pass.
Fifteen migrations passed schema-only rehearsal; production-shaped rollback and
full provider/release gates remain open. Sharing usable-connection/provider
filtering, remaining legacy integrations and Root configuration coverage remain
next work. Production/socialpilot-deploy remain legacy. Preserve photo canary lock.


## Batch81 — Sharing connection eligibility

One neutral channel query now governs Sharing selection, create/access-edit
validation and public visibility: selected target, current same-workspace
non-invalidated connection and enabled/entitled provider. Explicit empty ceilings
mean none; expired-token history stays readable. Public reads remain lock-free;
mutation transactions hold connection/target locks and recheck post coverage
after a post-row lock. Missing/cross-tenant destinations fail closed. Root
registry73 adds consumed sharing.channelPickerLimit. No migration/provider write.

Final isolated suite:2717 tests/322 files, zero skips; production build and serial
typecheck passed. Real PostgreSQL tests reproduced old public-read blocking and
proved corrected nonblocking reads plus mutation locks. Actual local HTTP/MCP/
Chromium probe passed orphan rejection, invalidation/deselection/platform disable
and an approval-preflight race with a verified live post blocker; no status or
feedback survived refusal. All disposable data/audits/media/settings cleaned or
restored exactly. Claude account1 reviewed and checked corrections; its final
read-only review found no new actionable findings. See SHARING_ELIGIBILITY.md
for evidence and provider-switch snapshot/rate/legacy/release limits.

Next substantial batch: Analytics Reports host integration (existing untracked
module), preserving legacy templates/schedules, adding durable run history,
shared generation/mail/worker ports, manifest/navigation, Root config and MCP
permissions/confirmations. Source inventory confirms this remains unintegrated.
Do not include unrelated untracked integrations automatically. Full Facebook
live coverage/photo cleanup, complete Root controls and production-shaped
migration/media/service rollback remain required. Production stays legacy.


## Current continuation: batch85 (supersedes earlier next-batch notes)

Working tree contains per-destination format storage and propagation, a shared sidebar format control, and native form-reset preservation. Details: DESTINATION_FORMATS.md. Local migration and eighteen-file schema-only rehearsal passed after actual backup/restore/count verification. Current candidate snapshot is `/private/tmp/formats85-reviewed/app`; final tests are being refreshed. Browser proves input and associated sidebar checkbox survive a dropped save; retry receives Next action redirect headers but navigation still needs diagnosis. No browser success claim until rerun passes. Unrelated untracked AI/feeds/media/integration modules are outside this batch. Both Claude accounts reviewed/implemented assigned slices; parent corrected explicit-value fallback and form reset behavior. Full goal stays active; Facebook native engine, live cleanup, parity and production-shaped rollback remain open.

Final batch85 evidence: isolated synthetic PostgreSQL suite 2,953 tests / 342 files, zero skips; typecheck and production build passed. Final actual HTTP/MCP probe passed format retention/update, invalid-format rejection, scope/grant denials and exact cleanup. Browser retry still hangs after an action303 with x-action-redirect, both without same-origin interception and with production runtime. Checkbox/input preservation is proven; the full eight-view browser matrix is NOT passed. No provider content or production service changed. Next: diagnose streamed action response completion/internal redirect render before claiming authoring recovery complete.


## Batch86: confirmed-save navigation

The stateful composer no longer relies on a server redirect response to settle its action state. Diagnosis proved the internal Posts RSC response and outgoing303 both completed, while Chromium remained pending even for a normal save. The service now returns an explicit success acknowledgement after the committed write; the composer navigates from that acknowledgement. The success state requires a server-owned destination, disables another submission, freezes text fields, focuses an accessible saved status and retains an ordinary fallback link. Cache invalidation failure after commit cannot return a retryable creation error; the shared refresh also includes Calendar. Authentication redirects and recoverable validation remain unchanged. This fixes observed behavior without claiming a particular upstream framework defect.

Evidence: 2,955 tests / 342 files, zero skips, typecheck and production build passed in the isolated reviewed snapshot. The real Chromium matrix passed Grove/Coast/Clay/Nightfall at1440px and390px: forced transport failure retains text, actual sidebar checkbox and selected format; deliberate retry and normal phone save reach Posts and create exactly one draft each with first comment and target format. All disposable posts/audits/sessions and temporary Root settings cleaned/restored exactly. Fresh save controls were also confirmed enabled in every theme. Both Claude accounts supplied bounded lower-cost reviews; post-commit failure, saved-state focus and locked-state recovery findings were addressed or checked. This closes batch85's observed save-navigation gate. No migration or provider write in batch86; production stays legacy.

Remaining scope includes the full native Facebook engine/live coverage, held photo-cleanup reconciliation, remaining legacy integrations and production-shaped migration/media/service rollback. Unconfirmed transport results still require checking Posts before deliberate retry; durable authoring idempotency across all entry points remains a useful hardening item. Do not advertise the complete rebuild as ready from this batch.


## Batch87 native transport and Root policy

Signed Facebook-owned Graph/resumable transport and registry76 native controls are implemented. Twenty-five native settings are grouped under Facebook and labelled configured; customer dispatch remains unwired. A local Root diagnostic validates one native configuration snapshot and cross-field limits without provider requests. The private constructor refuses missing required signing material. Real loopback HTTP tests verify encoding/signatures, response bounds and timeouts. See FACEBOOK_NATIVE_TRANSPORT.md. Root phone verification identified a long-search-heading overflow; shared settings heading/key wrapping fixes it.

The full objective stays active. Do not register the unscoped SQL proposal or treat this transport as complete native delivery. Keep the existing parent publication journal as the sole claim authority; next implement tenant-bound child phase receipts, payload identity/fencing, export/erasure and PostgreSQL concurrency checks, then native dispatch/status/comment/deletion and live cleanup. Production and the held photo-cleanup canary remain unchanged.


Final batch87 evidence:2,980 tests in346 files, zero skips, with guarded synthetic PostgreSQL and real localhost HTTP sockets. Final typecheck and production build passed. Actual local API/MCP and Chromium checks passed Root ownership, exact write confirmations, invalid/cross-origin denial, workspace-scope denial, schema76 auditing, native-policy diagnostics without provider reads, and desktop Nightfall/phone Grove viewport fit after long-key wrapping. Temporary Root settings restored byte-for-byte including timestamps, sessions and scoped test audits cleaned. Two lower-cost native agents contributed storage investigation/transport/wire tests; both Claude accounts supplied independent reviews. Findings corrected include body deadlines, pinned configuration, metadata/byte validation, missing-signing refusal and honest consumption status. Static whole-worktree premium audit remains34 findings; this batch does not clear unrelated UI. No provider write, migration or production deployment occurred.


## Batch88: native payload and receipt safety

The Facebook executor snapshots the complete used payload before its first await,
including a copied Buffer/Uint8Array and probed metadata. A versioned SHA256
identity covers target, format, caption, schedule, source, bytes digest and media
metadata without storing raw content in the identity. Matching recorded hashes
refuse changed payloads under an existing operation; older hashless proposal
records return a conflict and remain held without dispatch. Remote URL identity is not proof that the
server will return immutable bytes. Host media probing/binding remains required.

Every checkpoint and final settlement requires an explicit true write result.
A provider success followed by failed/unconfirmed local settlement returns an
uncertain result and cannot invite automatic resend. Staged IDs remain in known
identities rather than becoming final publication IDs. Repeated phase IDs are
deduplicated while phase receipts remain intact. Unexpected execution errors
return a held outcome. Submission results use status:submitted, require readbackRequired:true and
return no invented permalink; only later verified status can prove live delivery.
The scaffold row state still uses its historical published value for a submission
receipt; consumers must not treat it as live status. Unsupported schedule/caption
fields, non-byte runtime values and unsupported direct uploads fail before
claiming an operation. Canonical HTTPS URLs are intentional, matching transport
validation; credentials/fragments and ambiguous normalization are refused.

Native formats remain unavailable. The existing unscoped SQL store is still an
unregistered proposal; its missing hash/tenant binding is not fixed by executor
snapshots. The next database batch must replace it with a tenant-bound fenced
child journal under the existing shared publication claim, integrate export/
erasure and recovery guards, and pass actual PostgreSQL concurrency and migration
backup/restore checks before application. No migration or provider write belongs
to batch88. Production and the held photo-cleanup canary remain unchanged.

Next journal gates: [FACEBOOK_NATIVE_JOURNAL_PLAN.md](FACEBOOK_NATIVE_JOURNAL_PLAN.md).

Final batch88 evidence: isolated database-enabled suite3015 tests/347 files, zero
skips; production build passed. Serial typecheck passed after that build.
Thirty-five new identity/receipt tests cover Buffer mutation, changed payloads,
hashless historical holds, malformed port replies, runtime byte types, metadata,
unsupported fields and failed final writes without resend. Both Claude accounts
completed independent reviews; a correction review confirmed the prior fixes.
The shared result is now submitted, distinct from verified live status. There
was no new UI/browser, live provider, migration-application or production evidence
in this batch. The local SQL proposal and its static test remain uncommitted and
unapplied, pending the journal integration gates. Full goal remains active.


## Batch89: scoped native receipts and Root evidence

Facebook now owns a tenant-bound, payload-bound durable phase journal beneath the
existing sole publication claim. Creator-only dispatch fencing, monotonic SQL
receipts, retained late facts, installed erasure/outcome guards and redacted export
are implemented; the unscoped SQL proposal is removed. Root/API/installation MCP
read bounded evidence even while the platform is disabled. Compact module-owned
summary columns and keyboard-accessible details replace the identifier-heavy
Root table; filters remain in the contextual sidebar.

The19th migration is applied only locally after full backup/scratch restore and
PostgreSQL checks; all105 prior table counts and Root settings were preserved.
The complete19-file schema-only rehearsal passed. See
[FACEBOOK_NATIVE_JOURNAL_PLAN.md](FACEBOOK_NATIVE_JOURNAL_PLAN.md) for ownership,
evidence and next integration gates. Native customer formats remain unavailable.
Actual host authorization/status/comment/deletion and audited native recovery,
live Meta coverage, remaining parity and production-shaped rollback stay open.
Production and the held photo-cleanup canary remain unchanged.

Final batch89 evidence: isolated synthetic PostgreSQL suite3059 tests/350 files,
zero skips; final production build and serial typecheck passed. Fourteen actual
PostgreSQL cases cover ownership/fencing, all four phase chains, retained late
facts, strict constraints/purge gates and real export/erasure. The complete19-file
schema-only rehearsal passed. Actual local HTTP/installation-MCP/Chromium checks
passed anonymous/workspace-owner/scope denial, fence/credential privacy, unknown
action/cross-origin refusal, evidence visibility while Facebook is disabled and
eight Grove/Coast/Clay/Nightfall desktop1440/phone390 views. Receipt details open
by keyboard, filters stay in the drawer/sidebar and document width stays within
the viewport. All synthetic fixtures were removed; captured Root settings and
scoped configuration audits were restored exactly. Lower-cost agents implemented
SQL/recovery/UI slices; both Claude accounts supplied independent source reviews.

The local preview is the isolated final build at localhost:3200. Complete native
host authorization, verified status/comment/deletion, audited process-loss/native
conflict recovery, cleaned live provider coverage and broader legacy/configuration/
production rollback gates remain open. No live provider request or production
deployment occurred. Whole-app UX/accessibility is not cleared by this matrix.

Continuation mechanics: localhost:3200 now serves the reviewed isolated candidate
`/private/tmp/native89-final/app/rebuild` (production-mode Next, synthetic local
preview database). The two native89 scratch databases were removed after tests;
their old temporary environment file must not be reused as a live database.
Private backup/application metadata remains outside Git in
`/private/tmp/native89-backup.json` and `native89-local-application.json`; no
credentials or raw rows belong here. Final cleanup independently matched all105
prior local table counts and Root settings against the restored baseline, with
zero native fixture rows. Keep the full goal active and continue actual native
host/status/recovery integration, then remaining parity and release gates.
