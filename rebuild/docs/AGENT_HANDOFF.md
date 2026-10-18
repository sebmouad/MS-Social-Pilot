# Codex and Claude project memory / handoff

Updated: 2026-10-17. This is durable project context, not proof of current runtime
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

## Verified application baseline

Latest verified batch is 64: Publishing labels, password recovery and advanced
metric exploration, including independent domain/HTTP/MCP checks and registry
59 integration. Exact staged source passed 1,861 tests / 262 files with guarded
PostgreSQL checks, typecheck and production build. Source gaps, scope and proof
are recorded in PUBLISHING_LABELS.md, ACCOUNT_RECOVERY.md, ANALYTICS_EXPLORER.md
and PREVIEW_QA.md. Password reset lacks fresh real SMTP/DB/browser proof.

Previous published application batch `c6e1d89` adds templates/composer reuse,
Inbox assignment/notes/saved replies and workspace time zone/approval policies
(registry 58). Guarded real HTTP/MCP/DB probes now pass for those flows and for
labels/Explorer; cleanup restored exact settings and disposable fixtures.
Batch 64 fixes actual SQL advisory-lock/enum compatibility issues found by those
probes. Browser template create, phone review/offline error and delete cleanup
were observed; an uninterrupted online retry was disrupted by dev hot reload.

## Immediate continuation

The first Claude subscription reached its session limit after W1-W4 source
handoffs; later W5/W6/W7 files are partial, and W8 had not started. Codex worker
turns also stopped on exhausted workspace credits. The user explicitly selected
a second Claude account. Its isolated CLI profile was verified signed in and
distinct, without displaying account details. A second Sonnet coordinator has
launched four review/fix workers over W1-W4, then will reconcile/finish later
waves. See CLAUDE_ACCOUNT2_COORDINATION.md and private status
`/private/tmp/msp-claude-worker/account2-status.md`. First-run status remains
`/private/tmp/msp-claude-worker/coordinator-status.md`; per-worker results are in
the sibling `results/` directory. Never publish login state or credential files. Four initial slices delivered SOURCE/MOCKED TESTS ONLY:
Publishing collaboration, sharing/bio, Ads extensions and Root legacy controls.
Second-account Claude review workers now own Root W4, sharing W2, Ads W3 and
Publishing collaboration W1. Preserve partial Codex/parent review fixes, including
Root config/policy separation, sorted account locks and CAS concerns. The parent
must not edit those owned files concurrently. Root W4 focused mocks passed 77
tests before this handoff; this is not real SQL/browser proof or host integration. Later waves
cover remaining Analytics, agency/tasks, feeds/AI/media, integrations and native
Facebook formats. Modules requiring proposed migrations/host ports must stay
unavailable until integrated and verified; stored-only queue/recycle controls,
unverified Graph shapes or backup status do not count as complete features.

Lead owns central registry, manifests, permission/entitlement and MCP assembly,
review, exact-snapshot checks and Git publication. Do not broadly stage the
unfinished concurrent files. Preserve full target scope and keep useful legacy
gaps open until runtime/UI/API/MCP evidence exists. Production remains legacy;
all backup/restore and cutover gates still apply.

Known phone issue: at 390px emulation the document scroll width reached 601px,
with a wide fixed module rail and touch click timeouts; keyboard workflows worked.
The later fresh Templates phone check measured 390px throughout and touch controls worked; this does not establish every route/theme. Investigate the containing/visual viewport
and shared shell instead of adding screen-specific overflow clipping.

## Operational boundaries and remaining release gaps

- Local preview: `http://localhost:3200`; verify its live process before restarting.
  PostgreSQL preview is separate and synthetic. Do not publish environment files
  or credentials. Test guards require an explicit isolated loopback preview DB.
- Production still runs legacy. `socialpilot-deploy` still targets legacy.
- The live Facebook multi-photo canary has an explicit feed-deletion receipt but
  held photo-cleanup evidence. Unreadable objects or an incomplete listing do not
  prove deletion. Preserve the private ledger and per-Page lock; no blind retry or
  further canary on that Page. See FACEBOOK_LIVE_MEDIA_CANARY.md for safe context.
- Full onboarding/recovery, native Facebook formats, complete Inbox/Ads workflows,
  broad legacy capability parity, full Root/MCP coverage, live runtime proof,
  migration/media/permission rehearsal, backup/rollback and cutover remain open.
- Previous estimates: overall ~65%, design/UX ~80%, core ~70%, Facebook ~55%.
  These are subjective engineering estimates; do not inflate them from test count.

Update this handoff and the relevant evidence/plan documents when a batch changes
what the next agent must know. Preserve required target scope; report limitations
rather than rewriting the target around unfinished implementation.


## Batch 65 — private Root operations

Registry 60 integrates Root-owned plan controls, privilege directory/complete-or-refused CSV, account/workspace lifecycle inspection and ownership transfer, redacted error management, and recorded backup/diagnostic summaries. UI/API/installation MCP use shared current-authority services; workspace roles and API keys cannot grant Root. Mutations serialize affected accounts/workspaces and audit atomically. Filters and CSV controls occupy the existing contextual sidebar.

The guarded local `scripts/verify-root-operations.ts` passed actual HTTP/MCP/PostgreSQL operations, authorization refusals, confirmations, persisted outcomes and exact fixture/configuration cleanup. Desktop Chrome verified the privilege page and contextual filters. These checks do not prove phone/theme mutation flows, archive restoration, live provider capability or production readiness. Backup records report recorded status only. Production remains legacy; parallel Claude source slices are unfinished integration work and must not be included in this batch.

Batch 65 verification: isolated staged-source snapshot passed 1,947 tests / 264 files, typecheck and production build. Chrome desktop also refused repeated privilege filters without broader results or export. Claude second-account coordinator terminated on its session limit (reset reported 04:10 Africa/Casablanca); do not mistake its status file for a live process or restart its already-completed slices. W6c/W7b follow-ups require inspection before resuming.


## Batch 66 — Publishing collaboration source foundation

The Publishing-owned collaboration slice is preserved in version control with service, HTTP, UI and MCP metadata source for bulk label assignments, custom fields, internal notes/mentions, versions, queue times, content mix and recycling. It is NOT host-integrated or release-ready: its Root settings are not registered, customer navigation/MCP host registration and publishing lifecycle/worker ports remain unconnected. Do not report these capabilities as delivered to customers.

Lead review removed fail-open worker eligibility and per-run cached workspace grants. Missing owner-qualification callbacks now refuse before reads; each recycle item requires a fresh eligibility check. Three failing regressions establish the original bug; 68 focused mocked tests pass after the fix. Typecheck and production build passed the isolated source snapshot. Remaining security/integration gaps are explicit in PUBLISHING_COLLABORATION.md, including transaction-boundary checks, recycled-variant approval, destination authority, version hooks and PostgreSQL/browser/MCP proof. Continue integration; do not enable ports from metadata alone.

Batch 66 isolated full suite: 2,015 tests / 267 files passed with guarded local PostgreSQL tests enabled; typecheck and production build passed. Collaboration-specific tests remain mocked and do not establish its real data, browser or runtime integration.


## Batch 67 — usable Publishing organization

Registry 61 integrates Publishing collaboration metadata: bulk label assignment, complete bounded label choices, custom-field CRUD/values, internal note CRUD and stored version reads. The Organize manifest feature inherits the Posts plan/module switch while retaining its own installation switch. Shared services enforce current account/workspace/resource authority across UI, HTTP and authenticated workspace MCP, with transactional audits and complete-or-refused MCP results. Field updates/deletion reject corrupt cross-tenant relations. Execution controls are marked planned and unregistered ports remain hidden/refused.

Actual guarded local HTTP/MCP/PostgreSQL proof passed CRUD, persistence, confirmations, foreign-post/cascade refusals, read-only key and feature-disable refusals, and note pagination/navigation; exact fixtures/settings/audits were restored. Chrome phone field review/create/delete and cleanup passed at 390px with a 352px dialog. Offline retry has component proof. Keep lifecycle history recording/restore, scheduling/recycle/mix authorization, mention delivery, full theme/concurrency/data-control tests and remaining legacy capabilities in the active plan. Production remains legacy; no cutover or provider change.

Batch 67 follow-up UX review: choice-field forms still rely on server enforcement for option count/length, and newly added note timestamps are optimistic browser times until reload. Before production, mirror the consumed Root choice bounds in form feedback and return/use the database note timestamp. Current server validation and stored timestamps remain authoritative. Mention controls stay hidden without a delivery port; notes without mentions avoid the roster query entirely. Association MCP now includes `get_post_labels` and paged `list_post_label_choices`; notes/history display the workspace time zone. Phone Grove and temporary Nightfall visual inspection fit 390px; this does not prove theme-preference persistence or all controls in every theme.

Batch 67 final verification: isolated staged-source snapshot passed 2,040 tests / 269 files with guarded PostgreSQL tests enabled; production build and subsequent serial typecheck passed. The final HTTP/MCP/PostgreSQL probe passed and verified exact cleanup. Independent lower-cost review reported no critical/important findings in the staged authorization/tenant/data-control changes. This is not release readiness.

Next parallel ownership: `/root/ads_read68` owns Ads analysis/directory/compare/object read slices and ADS_PARITY.md; `/root/analytics_read68` owns Analytics demographics/pins/comparison read slices and ANALYTICS_PARITY.md. Both are reviewing/fixing existing untracked Claude source, tests and host-integration exports. Parent retains registry, manifests, MCP host, permissions, central navigation and Git. Do not stage their unfinished slices with batch 67; obtain results and real preview proof before exposing them. Claude second-account coordinator remains terminal on its session limit; its old status file is not proof of running work.


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
