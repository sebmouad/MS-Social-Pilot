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


## Batch 67 — usable Publishing organization

Registry 61 integrates Publishing collaboration metadata: bulk label assignment, complete bounded label choices, custom-field CRUD/values, internal note CRUD and stored version reads. The Organize manifest feature inherits the Posts plan/module switch while retaining its own installation switch. Shared services enforce current account/workspace/resource authority across UI, HTTP and authenticated workspace MCP, with transactional audits and complete-or-refused MCP results. Field updates/deletion reject corrupt cross-tenant relations. Execution controls are marked planned and unregistered ports remain hidden/refused.

Actual guarded local HTTP/MCP/PostgreSQL proof passed CRUD, persistence, confirmations, foreign-post/cascade refusals, read-only key and feature-disable refusals, and note pagination/navigation; exact fixtures/settings/audits were restored. Chrome phone field review/create/delete and cleanup passed at 390px with a 352px dialog. Offline retry has component proof. Keep lifecycle history recording/restore, scheduling/recycle/mix authorization, mention delivery, full theme/concurrency/data-control tests and remaining legacy capabilities in the active plan. Production remains legacy; no cutover or provider change.


## Batch 68 — integrated Ads and Analytics stored-data workflows

Registry 62 installs Ads analysis thresholds and Analytics demographic, comparison
and pin policies. Customer manifests and HTTP/workspace MCP expose scoped Ads
comparison/directory and Analytics breakdowns/comparison/personal pins through
shared module services. Facebook alone resolves its provider-specific parent
fields; management actions remain hidden without their separate engine.
Comparison controls display only the active mode. Audience failures preserve
correction/reset controls. READ_WORKFLOWS.md records scope and limitations.

An isolated staged-source snapshot passed 2,122 tests / 275 files with guarded
synthetic PostgreSQL tests, production build and subsequent serial typecheck.
Independent lower-cost reviews found no remaining important issue. The final
scripts/verify-read-workflows.ts probe passed real localhost HTTP/MCP/PostgreSQL
reads, current/previous Ads comparison, malformed/foreign scope refusals,
feature-disable refusals, pin confirmations/persistence, read-only key refusal
and authorized MCP pin/unpin. Both temporary tenants, resources, sessions, keys,
insights and audits were removed and exact prior Root settings restored.
Chrome verified desktop stored Ads figures, audience invalid-date correction,
and 390px comparison mode/drawer behavior; temporary Nightfall was restored.
The strict UI audit reports zero findings on changed routes and 38 elsewhere
in the whole working tree; complete UI/state/theme compliance is not established.

Next: finish lifecycle version recording/restore and its deterministic host ports;
review/integrate the remaining legacy source slices with their migrations,
configuration and authorization proofs. Unfinished source is excluded from this
batch. Full Ads writes, report generation/schedules, live Facebook coverage,
held-photo cleanup, migration/rollback rehearsal and cutover remain open.
Production remains legacy; socialpilot-deploy still targets legacy.


## Batch 69 — Publishing retained history and content restore

Registry 63 marks version retention as active. Create/edit (including local drafts
and new duplicates), scheduling/rescheduling and local schedule cancellation save
history in the mutation transaction. Duplicate retries retain one initial snapshot;
failed history writes roll back both post and receipt. Millisecond-monotonic
snapshot timestamps fix transaction-NOW ties that could misorder/prune versions.

The deterministic server composition registers lazy lifecycle restore for each
customer page, versions HTTP mutation and MCP handler. Current authorization,
post/version/workspace scope, destination/media rules, exact confirmations,
approval reset and transactional labels remain enforced. Restoring content never
replays a historical schedule/timezone; different-format versions are refused.
The UI reviews the actual consequence without requiring an opaque-ID transcription,
retains failed dialogs, and hides restore on known locked post states. Choice-field
bounds mirror consumed Root limits; new notes use their stored database timestamp.
See PUBLISHING_HISTORY.md for boundaries and open native/cross-format coverage.

The final isolated staged-source snapshot passed 2,133 tests / 276 files and a
production build. Serial typecheck passed after that build. The final guarded local
HTTP/MCP/PostgreSQL history probe passed content/media/target/label restores,
approval reset, exact-confirmation/foreign-version/published-post/read-only-key
refusals, rapid ordering/deduplication and five-version retention, with exact
fixture/audit/settings cleanup and no publication. Actual PostgreSQL concurrency
and duplicate rollback/replay tests passed. Chrome created/edited/restored a
labelled disposable draft, verified saved content and three history snapshots,
then deleted it and observed history 404. Normal UI audit receipts remain.
Independent lower-cost security review reported no important findings. UI tests
cover failed restore/retry/success and live Root option bounds. Static UI audit
has zero findings in changed collaboration owners and 32 elsewhere in the whole
working tree; broad phone/theme/keyboard/offline compliance remains unproven.

Next: fix the separate unproven demographic combined-total semantics; then wire
queue allocation through the validated lifecycle before enabling queue-times
ports. Content-mix/recycle jobs still need lifecycle-safe validation, approvals,
current owner qualification where applicable and real worker/database proof.
Remaining legacy integrations, Facebook live coverage and held-photo cleanup,
migration/rollback rehearsal and cutover stay open. Production remains legacy;
socialpilot-deploy still targets legacy. Do not broad-stage unfinished source.


## Batch 70 — honest demographic breakdown totals

Independent semantic review found that a shared category dimension and count
unit did not justify adding distinct breakdown measures or overlapping resource
populations. The module now retains each source metric, row, share and coverage
and returns combined:null. Selected-channel audience totals and normal per-metric
aggregation remain unchanged. Future cross-metric sums require explicit neutral
measurement/taxonomy/period and contribution-scope compatibility evidence.

The isolated staged-source snapshot passed 2,134 tests / 276 files, production
build and subsequent serial typecheck. Regressions cover separate fans/reach
measures, known overlapping resources and unknown scope. The extended guarded
local read-workflows probe checks fans (US12/CA8) and impressions (US31/CA69)
from the same channel via HTTP and MCP, preserving both independent results
without a fabricated combined total. The final probe passed and exact fixture/audit/settings cleanup was verified. READ_WORKFLOWS.md records semantics and scope. No schema/configuration
registry change, live provider operation or production cutover belongs here.

Next delivery: wire queue allocation through the existing validated lifecycle,
with workspace-timezone slot selection, per-channel/shared intersection,
transactional collision protection and UI/API/MCP parity before enabling its
host marker. Content mix/recycle still bypass lifecycle validation/history and
must remain hidden until corrected. The active-owner automatic-sync policy must
not be assumed to remove the scheduled publisher's current author permission
checks; resolve job-specific authority explicitly and preserve the contract.
All remaining legacy/provider/migration/rollback/browser/release gates remain
open. Production and socialpilot-deploy remain legacy.


## Batch 71 — saved queue times and lifecycle allocation

Registry 64 installs Publishing-owned initial timetable defaults and activates
queue-slot/lookahead bounds. Posts can enter the next valid shared/channel slot
through one current-authorized, lock-serialized service used by HTTP and workspace
MCP. Allocation preserves approval holds, records history and audit atomically,
checks content/media/destinations and never publishes immediately. The contextual
sidebar owns timetable selection; per-scope unsaved drafts survive selection
changes. Review shows actual destinations, slots and workspace timezone.

The isolated staged-source snapshot passed 2,148 tests / 279 files, production
build and subsequent serial typecheck. Independent source review found no important
remaining issue. Chrome verified desktop sidebar selection, draft retention/discard
and a 390px phone layout. The final guarded HTTP/MCP/PostgreSQL queue probe passed, including actual
authenticated HTML showing the changed Root default time and workspace timezone.
Five temporary drafts and related fixtures were removed, and all ten captured
Root settings and synthetic audit rows were restored exactly.
The optional static UI audit runner is no longer installed; no fresh pass is claimed.

Initial interrupted probe runs lost prior in-memory configuration snapshots.
Exact pre-interruption settings cannot be claimed restored. A private preview
backup was scratch-restored and counts/checksum matched before confirmed orphan
fixture cleanup. A new typed, audited preview baseline was established. Subsequent
successful guarded execution restored its captured baseline exactly. The hardened
probe writes a private recovery ledger before mutations and keeps it on cleanup
failure. See PUBLISHING_QUEUE.md and CUTOVER.md for scope and evidence. Production
was untouched; this is not release rollback or arbitrary-kill recovery proof.

Next: publish this verified batch; then integrate
content mix/recycling through lifecycle-safe validation, approvals, history and
current job authority. Full composer queue-mode parity, remaining legacy modules,
Facebook native formats/live coverage and held-photo cleanup, production-shaped
migration/rollback and cutover remain open. Production/socialpilot-deploy remain
legacy. Do not broad-stage unfinished source slices.


## Batch 72 — Publishing automation and customer controls

Registry 65 installs Publishing-owned recycle/mix jobs, cron schedules and typed
persistent scan positions. The existing worker now calls required lifecycle ports;
raw copy/schedule shortcuts were removed. Current original-author permissions,
per-provider current owner qualification, selected-resource/destination locks,
content/media/credential readiness, approval policy, history and system audits
apply in the same transaction as claims. Changed wording is held for review where
required; exhausted limits and disabled destinations stop without consuming a run.
Fair keyset scans advance past failed/skipped work; cursor writes use value-CAS
and value-free audit. Global fairness/CAS has mocked regression coverage, not yet
production-shaped multi-worker PostgreSQL proof.

Content mix has a separately confirmed all-channel owner/admin workspace opt-in,
shared HTTP/MCP services and sidebar controls. Counts apply complete post and
resolved author scope; per-scope drafts and failed reviews survive correction.
Both automation APIs initialize their own server bundle's ports. A real phone
check found the drawer consuming modal Escape/Tab; the shared shell now defers
to native dialogs. Chrome verified modal Tab containment, 352px review at 390px,
Escape ordering/focus restoration, desktop controls and temporary Nightfall rendering.
No seeded workspace automation was enabled in browser testing.

The isolated final staged snapshot passed 2,186 tests / 280 files and a production
build. Subsequent serial typecheck passed. The guarded actual
HTTP/MCP/PostgreSQL probe passed opted-in scheduling/replay, read-only/confirmation
refusals, system history/audit/labels, variant approval hold, revoked access
immutability, disabled-destination stop and zero provider publication attempts.
Two disposable drafts, their generated repeat and related fixture records were
removed; eleven captured Root settings, including the prior encrypted adapter
secret, were restored exactly. No production, provider write or DDL changed.
PUBLISHING_AUTOMATION.md owns full semantics, proof and limitations.

Next: wire dry/mention notifications, large-workspace bounds and remaining legacy
module slices with their authorization/migration/worker/MCP proofs. Finish native
Facebook formats and live capability coverage, resolve the held photo cleanup,
and rehearse production-shaped data migration/rollback before cutover. Existing
socialpilot-deploy still targets legacy. Do not broad-stage unfinished source.


## Batch 73 — personal alerts and durable delivery

Registry 66 adds Settings-owned notification preferences, a private personal
in-app alert list and queued email for note mentions and content-mix dry events.
Publishing writes source events and recipient intents atomically. Current
workspace, feature, member and selected-resource authority is checked again
before delivery. Email opt-out retains in-app alerts. UI, HTTP and workspace MCP
share services, exact write confirmations and personal recipient scope. Lost
resource access redacts source references, including internal event identifiers.
Typed Root bounds, cron, copy, preference defaults and retention are consumed.
SMTP ambiguity and expired sending claims stay uncertain without automatic retry.
Content-free claim/result/cancellation/retry/expiry/retention audits are durable.

The isolated source snapshot passed 2,209 tests / 283 files, production build
and subsequent serial typecheck. A guarded actual localhost HTTP/MCP/PostgreSQL
and SMTP-capture probe passed atomic/idempotent mentions, recipient-only reads
and writes, key restrictions, confirmations, opt-out, redaction, feature-disable,
sent-once and expired-claim holds, delivery audits and atomic retention audit.
All disposable fixtures/mail/audits and captured Root settings were restored.
Chrome verified desktop rendering and a 390px phone drawer with a 352px review,
Tab containment and Escape focus return. Temporary Nightfall rendering was
inspected and restored to Grove; preference review was cancelled without saving.
Full browser mutation/retry/all-theme proof is not established.

The notification migration was backup/restored and scratch-applied before local
preview application, preserving legacy counts/settings checksum. Cutover has its
checksum and ninth-migration refusal/schema gates; a complete nine-migration
production-shaped rehearsal remains outstanding. See NOTIFICATIONS.md for scope.

Next: verify real mix-dry event generation and notification concurrency, finish
legacy event delivery and large-workspace behavior, and integrate the reviewed
Claude Facebook-native/Ads slices through current host contracts and real data
proof. Those slices remain outside this batch. Complete held-photo cleanup,
production-shaped migration/rollback and remaining release gates before cutover.
Production and socialpilot-deploy remain legacy. Do not broad-stage unfinished
source or the unused old NotificationsForm dependent on Integrations.


## Batch 74 — durable Ads object management

Registry 67 registers Ads-owned operation policy. Facebook-owned host assembly
exposes a neutral optional engine for status, budget, rename, existing-creative
assignment and delete. Shared management services back UI/HTTP/workspace MCP;
the older status/budget API/MCP shapes delegate to them. Current key target scope
is intersected with fresh access. Same actor/workspace request identity binds the
normalized account/payload; successful replays do not resend. A durable intent
precedes provider I/O; dispatch rechecks pending state/authority under the account
selection lock and passes its abort signal into Facebook transport. Ambiguity
stays held. Explicit pending recovery and uncertain attestation use the same lock
and CAS, preserve receipts, and remain available for retained disabled accounts.
Connection deletion refuses unsettled journals. UI retains request identity across
unknown responses and requires a fresh review after terminal resolution.
Campaign/ad-set creation still needs equivalent durable journaling/recovery.
Management remains off by default; this is not completed Ads or live-provider parity.

The isolated snapshot passed 2,284 tests / 288 files and production build plus
serial typecheck. Three actual PostgreSQL tests cover request uniqueness,
uncertain holds/history and dispatch/recovery lock exclusion, workspace lock
independence and release; fixtures roll back. The guarded local recovery probe
passed real HTTP/MCP history, confirmations/read-only/foreign refusals, retained
account pending/uncertain attestation, persisted outcomes/audits and feature gates.
Both audit stores and fixtures were cleaned and five Root settings restored
exactly. An initial probe checked the wrong audit store; two orphan disposable
audit rows were subsequently removed with scoped orphan guards. Final proof
checks both stores. No arbitrary-kill recovery claim is made.

Chrome inspected desktop details with unavailable management hidden. A phone
check found intrinsic page-grid expansion; the shared one-column grid now shrinks
its track and leaves tables locally scrollable. Chrome measured page/client/scroll
width 390px and table viewport 320px afterward. The CSS-final isolated build and
serial typecheck passed. Full mutation/offline/all-theme browser evidence remains
open. The Ads migration was fresh-backup/scratch-restored and scratch-applied
before local preview application with legacy counts/settings preserved. Cutover
has ten checksum-pinned migrations; the complete staging rehearsal is still open.
See ADS_PARITY.md. Production and socialpilot-deploy remain legacy.

Next: complete durable creation/ad-set/creative workflows and actual provider
capability verification; finish Facebook-native host integration without enabling
unverified formats. Preserve the held-photo canary lock. Continue remaining
legacy module integrations, migration/media/rollback rehearsal and release gates.
Do not broad-stage unrelated source slices. No provider/production write belongs
to this batch.

## Current batch order — 2026-10-18

1. Finish reviewed Ads creation integration and reload recovery; verify UI/API/MCP
   outcome truthfulness, publish only the proven batch. Migration infrastructure
   is already published as `03580cf9`.
2. Integrate the independently prepared Tasks module with manifest-driven Root,
   shared authorization, scoped MCP, comments migration and data lifecycle proof.
3. Complete Agency cross-workspace administration without exposing it to a key
   scoped to one workspace. Then integrate remaining sharing, feeds/AI/media,
   report workflows and developer integrations from honest parity inventory.
4. Complete Facebook native-format/live operation proof and held-canary cleanup;
   rehearse production-shaped data/media migration and exact service rollback.
   Production cutover remains blocked until every release gate passes.

Use Claude workers for independent implementation and review. Parent owns host
integration, verification and explicit main commits; no broad staging of
unfinished feature source. Passing baseline checks never substitute for
revalidation after review fixes.

## Batch 76 — Tasks and guarded erasure integration

Tasks is host-integrated at `/tasks`: manifest/Root registry 69, shared current
authorization, HTTP, ten scoped MCP tools and resource, comments, linked-post
visibility, atomic checklist dates and optimistic updates. Delete requires a
consequence checkbox. Shared erasure now follows FK child-before-parent order
without bypassing purge guards. Two additive migrations were backup/restored and
applied only to local preview. See AGENCY_TASKS.md and CUTOVER.md.

Isolated snapshot passed 2,428 tests / 298 files (zero skips) and production build.
Serial typecheck also passed. Seven real PostgreSQL constraint/purge tests and the guarded HTTP/MCP/export/
erasure probe passed, preserving foreign data and restoring settings/fixtures.
All thirteen migrations passed schema-only rehearsal, not production-shaped
customer-data/media rollback proof. Phone create/comment/edit/delete passed;
shared bottom-navigation scroll clearance fixed a reproduced action overlap.
Four synthetic example tasks remain intentionally.

Independent final Claude review did not complete: DNS failure, then automatic
approval review rejected restart because workspace credits were exhausted. User
said they would refill; availability is not yet confirmed. Local checks continue.
Tasks configuration/paging/concurrency and browser limits are recorded in
AGENCY_TASKS.md. Agency and other untracked slices remain unfinished and excluded.
Production/socialpilot-deploy remain legacy. Preserve held-photo canary lock.
