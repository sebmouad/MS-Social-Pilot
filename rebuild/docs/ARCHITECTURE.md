# MS Social Pilot architecture

## Authority

[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) is the mandatory target for Codex, Claude and subagents. This file describes implementation and gaps only. Follow [../../AGENTS.md](../../AGENTS.md); do not infer architecture permission from an unfinished boundary.

Updated 2026-10-19. This document distinguishes the intended production architecture from the current rebuild. A component existing in source is not proof that its complete workflow is production-ready.

## Format catalog and legacy intent bridge (batch84)

Adapter formats are opaque neutral metadata. Scoped destination choices and MCP
expose validated customer-safe catalogs, with credential-aware operation flags
and per-destination invalid-catalog isolation. Facebook declares feed only and
consumes its label from Root (registry75). Shared publication preflight checks
stored format before any destination claim; schedule/queue/duplication also check
format. The thin Prisma mapping now preserves the existing legacy Post.format.
This is a post-level compatibility bridge, not the final per-destination intent
model; complete authoring/CSV/template/export/native transport remain required.
No new migration, customer format or live capability is claimed. See
[FACEBOOK_NATIVE_FORMATS.md](FACEBOOK_NATIVE_FORMATS.md) for evidence and next work.

## Native-format safety checkpoint (batch83)

Facebook native format scaffolding is versioned but remains unregistered and
unavailable. Phase intent/remote identity checkpoints, strict finish receipts,
conservative status/deletion interpretation and numeric metadata validation have
mocked regression coverage. No new customer format, Root setting, migration or
live provider capability is claimed. See [FACEBOOK_NATIVE_FORMATS.md](FACEBOOK_NATIVE_FORMATS.md).
The SQL store proposal is not an approved tenant-bound production journal.

## Structure

```mermaid
flowchart TD
  Browser[Customer web app] --> Entry[Authenticated routes and server actions]
  Client[AI and automation clients] --> MCP[Authenticated MCP endpoint]
  Entry --> Services[Shared application services]
  MCP --> Services
  Services --> Access[Workspace permissions and entitlements]
  Services --> Registry[Platform capability registry]
  Registry --> Facebook[Facebook module]
  Registry --> Future[Future installed platform modules]
  Facebook --> Remote[Facebook APIs]
  Services --> Data[PostgreSQL and media storage]
  Worker[Background worker] --> Services
  Worker --> Registry
  Root[Private Root control plane] --> Config[Validated versioned configuration]
  Config --> Services
  Config --> Registry
  Services --> Audit[Audit history]
  Root --> Audit
```

The rebuild uses Next.js App Router, React, TypeScript, Prisma, and PostgreSQL. A separate worker executes scheduled publishing and provider synchronization. UI, API, MCP, and worker entry points must converge on shared application services so that authorization and behavior do not diverge.

### Self-contained module folders (2026-10-19)

User decision, 2026-10-19: each module declares its own Root settings, MCP surface and screens so parallel work does not edit central files per capability.

```text
src/modules/<module>/
  manifest.ts      routes, features, Root setting namespaces (client-safe)
  config.ts        <MODULE>_MODULE_CONFIG: every Root registry entry the module owns
  mcp.ts           <MODULE>_MCP: McpToolGroup[] (tools, features, write flags, confirmations,
                   lock/manager rules, resources, restricted-credential scope classes)
  server/          product services, queries and policies (no provider rules)
  ui/              route screens and their components; app/<route>/page.tsx re-exports them
src/modules/installed-config.ts   installed product-module config lists (one line per module)
src/modules/installed-mcp.ts      installed product-module MCP groups (one line per module)
src/platforms/<provider>/         platform modules; settings via PLATFORM_CONFIG
```

`lib/config/registry.ts` merges `PLATFORM_CONFIG`, `INSTALLED_MODULE_CONFIG`, `lib/config/shared-config.ts` (auth, jobs, sync, data, storage, MCP, Root) and generated availability entries; key names and `CONFIG_SCHEMA_VERSION` semantics are unchanged. `server/mcp/server.ts` and `modules/settings/mcp-access/tool-policy.ts` merge installed `McpToolGroup` declarations (`server/mcp/kit.ts`) with no per-tool lists; Root tools stay host-owned in `server/mcp/root-tools.ts`. A new capability edits only its module's `config.ts`/`mcp.ts`; `CONFIG_SCHEMA_VERSION` still bumps in `registry.ts` when a key or its stored shape changes.

`src/server` keeps platform-neutral infrastructure only: authentication, permissions, entitlements, configuration store, jobs, mail, data control, diagnostics, Root and the platform host. Former `server/{ads,inbox,publishing,analytics}` code lives in `modules/<module>/server`; shared media storage/inspection lives in `modules/publishing/server/media` because Publishing owns its settings. Product route pages under `app/{publishing,inbox,analytics,ads,settings,agency,tasks,home}` and the public share/bio pages are thin re-exports of `modules/<module>/ui/**` screens, keeping only static Next segment config (`dynamic`). Root, authentication and shell routes remain in `app/`.

## Product modules

Product modules describe what a customer can do. They are independent of social networks.

| Module | Responsibility |
| --- | --- |
| Publishing | Compose, drafts, duplication, CSV import with first comments, media, approvals, queue, calendar, publishing, status refresh, and local/remote deletion |
| Inbox | Conversations and comments, replies, moderation, resolution, and synchronization |
| Analytics | Selected-channel audience totals, metric series and breakdowns, provenance, coverage, freshness, and export |
| Ads | Selected ad accounts, delivery results, object status, budgets, and supported creation/management workflows |
| Settings | Workspace connections and account selection, team permissions, account security, appearance, MCP access, and data controls |
| Root | Private installation configuration, platform availability, users, workspaces, and operational controls |

`src/modules/` contains customer module manifests. The shell derives navigation from these manifests and workspace entitlements. Root routes have separate instance-owner authorization. The current route families are `/publishing/*`, `/inbox`, `/analytics`, `/ads/*`, `/settings/*`, and `/root/*`.

The user clarified on 2026-10-16 that Root administers every product and platform module while module source remains self-contained outside Root. Current implementation is incomplete against that requirement: product manifests live under `modules/`, but much product implementation remains distributed across `app/` and `server/`; Root now has a unified module navigation/settings workflow, while module-specific operational health/actions and complete source encapsulation remain unfinished. Do not describe the current layout as complete module encapsulation or complete Root coverage.

## Platform modules

Platform modules describe how a provider fulfills a capability. Facebook is the only installed platform module. Existing Instagram source is scaffolding/legacy compatibility; it is not an enabled customer platform.

Each platform owns its manifest, settings definitions, OAuth flow, discovery, credentials/scopes, API transport and pagination, provider validation, publishing, status mapping, remote deletion, inbox behavior, analytics interpretation, Ads behavior, and background hooks. Provider UI choices and explanatory copy also belong to the module. Shared screens consume safe serializable metadata; credentials and server functions never cross to the browser.

The module registry checks installation, Root enablement, and capability support before dispatch. Unsupported operations must be omitted from the customer experience. A general `ads` or `publishing` flag alone is insufficient proof that every sub-operation exists; finer operation coverage remains necessary.

Adding a platform requires implementing and testing its module, then registering it in the installed lists and shipping a release. Root manages settings and availability of installed modules. Root cannot create a new provider implementation merely by entering an API URL.

Current locations:

- `src/platforms/<provider>/`: provider engine, settings manifest, runtime construction, OAuth state and connection/discovery flow, host assembly, jobs, Inbox and Ads implementation, metric metadata and protocol error classification.
- `src/server/platforms/`: neutral host contracts (`host.ts`), explicit installed host registration (`index.ts`), resource visibility and capability dispatch (`registry.ts`).
- `src/platforms/types.ts`: common operation contracts. Campaign objectives are opaque strings validated by each module; the Facebook enum belongs to its protocol file.

Shared analytics now consumes normalized module outputs: provider storage queries, metric interpretation and currency partitions live in the Facebook module. Inbox reply eligibility and its presentation metadata also come from the selected module; the Messenger window and its configuration read live inside Facebook. UI and MCP Inbox reads share selected-channel, workspace, permission and enabled-module filters. Media HTTP and MCP tools now share typed safe validation/storage failures; unexpected storage errors are masked. Ads service and module failures use safe typed operation errors; shared Ads HTTP routes no longer match provider messages, and MCP Ads operation calls apply the same sanitization boundary. The strict final boundary is still incomplete: other shared route error mappings name Facebook, legacy-shaped MCP reads need consolidation, and operation declarations are too coarse to prove every sub-capability. Moving files alone does not close these gaps.

## Root navigation and module settings ownership

Root sidebar groups **Shared controls**, **Product modules** and **Platform modules**. Groups are native keyboard-accessible disclosures; the current section expands automatically. Product/platform links come from installed manifests, rather than a second hardcoded catalog. `/root/modules` lists installed product modules; `/root/modules/[id]` and `/root/platforms/[id]` expose only that module's controls. Unknown/uninstalled identifiers are refused after Root authorization. The existing two-sidebar shell and mobile drawer remain the only navigation surfaces.

`lib/config/ownership.ts` assigns one owner to safe registry metadata. Platform entries declare their owner inside their adapter and take precedence over product namespaces, so the provider-owned reply window remains under its provider despite its historical key. Product manifests declare namespaces and additional legacy setting keys; module/feature availability is assigned to the declaring product automatically. Global authentication, shared worker/storage/locking policies and other shared infrastructure remain in Shared configuration. Existing key names, runtime readers, values and encrypted credentials are unchanged.

Registry version 34 exposes `owner` metadata through safe definitions (including HTTP/MCP), without saved secret values. Root module screens reuse the existing validated/audited setting service and scoped form. Product availability/feature controls appear first; provider categories omit the repeated provider group prefix. Search/categories live in the contextual sidebar and cannot return unrelated module controls. Module form state remounts by owner when switching modules. Store failures keep navigation/recovery available; declared adapter operations are explicitly distinct from live-provider health or complete coverage.

This implements module menu/settings organization, not the full module-management end state: per-module health/actions, missing operator workflows, every technical configuration consumer and full product implementation encapsulation still require work.

## Connection and data lifecycle

1. An authorized member starts a connection for an available platform.
2. Server-bound OAuth state ties the callback to the user and workspace.
3. The platform discovers channels and ad accounts. Tokens remain encrypted server-side.
4. A selection modal shows discovered resources with checkboxes. Only selected resources become active product resources; users can revise the selection later.
5. Shared workflows resolve each resource's provider and invoke its enabled capability host.
6. Disconnect asks whether related app data should be retained or deleted. Local post deletion separately offers remote deletion when a remote publication exists.

Workspace is the tenant boundary. Connections own discovered channels and ad accounts; posts have per-channel delivery records and remote IDs; conversations/comments, insight records, media, and job records link back to workspace-owned resources. Existing production tables are currently accessed through a partial Prisma compatibility view. This is not yet a clean final persistence model or an approved production migration schema.

## Authorization and MCP

Every customer workspace operation must enforce authenticated identity, workspace membership, feature entitlement, feature read/write permissions, resource/channel scope, platform availability, and operation-specific provider grants. Private Root operations instead require current installation-owner authority and do not inherit workspace privileges. Client-side hiding is only presentation; mutation services repeat server-side checks.

MCP is served at `/api/mcp`. It supports authenticated workspace access, scoped API keys, tools/resources, confirmations for writes, and audit records. It calls the same application services as the web app wherever those services exist. Root MCP access is restricted separately; workspace API keys cannot gain installation-owner privileges. Full UI/API/MCP parity is still incomplete and must be verified capability by capability. All tool calls now expose only deliberate `OperationError` messages/codes; unexpected failures are masked at the shared MCP response boundary. Resource failures carry the same safe code in JSON-RPC `error.data`. Publishing, Inbox, connection selection and data-control validation/access failures use typed public errors, while raw database/provider/storage exceptions remain untrusted. Unknown write failures tell clients to check current state before repeating. Secondary MCP audit failures preserve returned service outcomes with `mcpAuditRecorded: false` and an explicit warning rather than falsely reporting action failure. Domain audits, remote-success/local-persistence uncertainty and durable reconciliation still require operation-specific guarantees; this boundary is not proof of exactly-once delivery or complete audit durability.

Private Root workspace access uses `server/root/workspace-access.ts` for UI API and MCP. It rechecks current installation-owner authority and disabled-account state, takes an exclusive workspace row lock, refuses active data purges, requires an exact stable-ID action confirmation and commits the state change with its audit entry. The legacy `suspendedAt` column is accessed through bounded compatibility SQL; no schema migration was applied. Shared workspace operations take a compatible shared row lock and refuse a suspended workspace before side effects. Provider background sync now uses that same lock across network retries and storage. In-flight work finishes before suspension commits. Ordinary customer entitlements are denied; private Root inspection and restoration remain possible.

The new Root MCP tools are `list_root_workspaces` and `set_root_workspace_access`, with `msp://root/workspaces`. Reads use the smaller configured Root directory and MCP result limits. These tools have typed public errors and redact unexpected failures; workspace API keys cannot list or invoke them. Root operations deliberately bypass the ordinary shared workspace operation wrapper to avoid upgrading a held shared lock to exclusive and to permit restoration. The HTTP MCP authentication path now supports a distinct installation identity without workspace membership; see the context rules below.

Private Root audit history now uses `server/root/activity.ts`. UI `/root/activity`, HTTP `/api/root/activity`, MCP `list_root_activity` and resource `msp://root/activity` share a service that rechecks current installation-owner/disabled state before any audit query. Action/person substring search is literal and SQL-bound; exact workspace filtering matches top-level `detail.workspaceId` only. UTC date endpoints are inclusive; the SQL upper bound is the following midnight. Validated date text is cast to PostgreSQL date; cursor anchors bind canonical ISO text with explicit timestamp casts so comparisons to legacy UTC `TIMESTAMP(3)` storage do not depend on the session timezone. Tuple cursors order by that millisecond timestamp and stable ID, bind to normalized filters and support nearest-newer/older navigation without offset drift from new events. The response contains the existing allowlisted metadata projection, never raw audit payloads. Cursor tokens are seek positions, not authorization grants.

Operational audit page, search and encoded cursor bounds are validated Root settings. The only fixed cursor invariants are its version, canonical base64url JSON shape, SHA-256 filter digest and timestamp precision matching `TIMESTAMP(3)`. This adds no DDL. Substring/workspace queries still need production-volume plan/load evidence and possible reviewed indexes; exports, raw-detail inspection, retention and generic log/error administration are not implemented by this read surface. Private MCP context authentication is now independent of membership as described below.

MCP identities are discriminated as workspace or installation in `server/mcp/types.ts`. `?scope=installation` accepts only a fully verified active installation-owner session, does not load workspace grants, and exposes only private Root tools/resources. `?scope=workspace` requires actual membership, current grants and a permitted workspace role, and does not expose Root privileges even to an installation owner. Without an explicit scope, current workspace behavior remains; an owner falls back to private installation context when membership/role/grants are absent. A supplied bearer always controls authentication and never falls back to a browser cookie; workspace keys cannot enter installation context. All workspace contexts disable the installation-owner suspension-inspection exception in `loadEntitlements`; workspace access does not inherit private authority from its session or key creator. Invalid/repeated scope values are rejected. Global MCP availability and configured limits still apply, with a per-owner installation rate key and no fabricated workspace ID/entitlements.

`server/mcp/root-tools.ts` owns private definitions, resources and the shared dispatcher for both session contexts. Every Root operation rechecks current account/owner state before services; all its unexpected failures are masked. Configuration input is checked against the same typed registry and exact confirmation, then `saveConfig` commits its setting and value-free audit atomically. The former independent post-save MCP audit was removed for this operation so a secondary audit failure cannot misreport a committed change as failed. Workspace access retains its own transactional audit. HTTP authentication/transport responses and protocol replies use `no-store`. Root overview contains private session-connection guidance; a membership-free owner encountering `/no-workspace` recovers to `/root`. Customer empty states retain invitation/sign-out recovery without private setup copy.

Installation-scoped bearer issuance/OAuth is not implemented; the private context currently requires a verified browser session. This closes the membership dependency for existing Root operations, not all Root UI/API/MCP capability parity. The shared MCP unexpected-error boundary is implemented; durable domain auditing/reconciliation and the complete operator inventory remain open.

## Root user directory and account controls

Private Users UI, HTTP `GET /api/root/users`, MCP `list_root_users` and resource `msp://root/users` share `server/root/users.ts`. Current active Root authority is required before reading names/emails, access state, membership/factor counts or active verified session counts. Search is literal (PostgreSQL wildcard characters escaped), bounded by the registry and combined with all/active/disabled/owners status. Pagination is bounded and stale pages clamp to the matching count; credentials, factor material and session identifiers are excluded.

HTTP account actions and MCP `manage_root_user` share `root/user-controls.ts`. Serializable transactions lock actor/target user rows in stable order, recheck current active installation authority and target state, require shared exact confirmations, preserve self/last-owner/owner-factor-reset guards and commit local changes/session revocation/domain audit together. Serialization conflicts request a reload; unexpected failures are masked. Workspace API keys cannot reach these operations. Sign out changes browser sessions, not workspace API keys; disabling the creator separately blocks key authentication through current-user checks.

User filters and pagination live in the contextual sidebar. Dialogs retain confirmation/error input, prevent duplicate submits, and require a matching HTTP receipt before showing success and refreshing. Unknown results ask operators to inspect state/activity first. Registry version 33 manages user-search and account transaction bounds. User deletion, privilege assignment, plans and complete per-module operations/health remain incomplete.

## Configuration

The typed configuration registry supplies schemas, defaults, groups, safe display metadata, and a schema version. Runtime reads validate persisted values. Root writes validate changes and save audit history transactionally. Secrets are encrypted and omitted from ordinary configuration reads.

The required final coverage includes platform settings, endpoints/scopes, limits, schedules, permissions, entitlements, branding/themes, retention, logging, jobs, and MCP. Some registered options are still marked planned, and not all current literals are registry-backed. Therefore the requirement that Root manages every operational option is not complete.

Bootstrap trust remains outside ordinary Root editing: database access and encryption-key material must be available before Root can read configuration. Provider protocol constants belong inside adapters, documented separately from configurable policy.

## Design and UX

One shell, semantic design tokens, shared components, and selectable Grove, Coast, Clay, and Nightfall themes serve every module. `DESIGN.md` records the visual system; `UX-CONTRACT.md` records behavior. Navigation, filters, and resource selection share the sidebar. Responsive layouts, keyboard focus, validation, loading/error/empty states, confirmations, and permission-sensitive actions must behave consistently across screens. The design foundation exists; complete browser verification and polish are still release gates.

The user approved core design first on 2026-10-16. The shell now has a narrow module rail and contextual sidebar, permission-aware New post action, membership-backed workspace switching, and one contextual drawer on narrower screens. `SidebarDock` places route-local Root configuration search/categories into that same sidebar. Posts defaults to Table and offers Feed/Cards using one scoped paginated query and existing action controls; the neutral preview includes stored text, media/link references, first comments and destination outcomes. A separate private Root manifest generates Overview, Operations, Activity and installation navigation. Overview uses actual counts; activity reads bounded, redacted audit history with sidebar search, UTC date/workspace filters and tuple cursor pagination; worker health distinguishes unavailable telemetry from missing replacement-worker heartbeats. The next publishing batch adds a recoverable dedicated composer, shared full previews in queue/approvals and calendar dialogs, server-resolved workspace time presentation and guarded synthetic image examples. Transport failures retain composer state and distinguish an unconfirmed save from a confirmed failure. This is continuing core design work, not complete core or Root parity. Follow [CORE_DESIGN_PLAN.md](CORE_DESIGN_PLAN.md) before adding further Facebook operations.

## Jobs and release safety

The worker dispatches shared publishing and module-owned synchronization with job leases, run history, retries, and configured schedules. Production cutover must prevent the legacy and rebuild workers from publishing the same queue.

The legacy app remains the production service. The existing `socialpilot-deploy` command still targets legacy. A rebuild cutover needs an exact release, needed-data migration, media verification, functional and authorization checks, real provider and MCP tests, a restorable backup, and a rehearsed proxy/service rollback. `docs/CUTOVER.md` records the current blockers. No production-ready or deployment claim follows from a passing build alone.

## Verified progress and remaining scope

Shared Ads dispatches by selected-account provider, uses module-owned creation metadata, and enforces current resource scope in services and lists. Shared analytics loading and aggregation consume neutral metric/audience inputs; the enabled Facebook host owns storage reads and semantics. Monetary series are separated by currency, ratios derive from source totals, unknown numeric measures use snapshots, and duplicate retained fields are not double-counted. The current integrated suite passed 503 tests, including both rollback-only PostgreSQL delivery and Inbox audit probes against the dedicated synthetic preview database. Current TypeScript checking and an isolated production build passed. Ads HTTP routes and all MCP Ads tools now share safe typed failure handling, including creation metadata; resource-read failures return safe JSON-RPC errors. Ads mutations accept exactly one status or budget change, and MCP no longer coerces string budgets. Shared selected-resource visibility now feeds channel reads, Home, Ads account lists and MCP destinations; enabling a selection checks module availability and credential health. Inbox policy is dispatched through platform hosts and UI/MCP Inbox selection filters are shared. Connection status copy is managed by Root. Shared native dialogs now recover focus after failures and retain failed Inbox deletion context; targeted Chrome checks cover Ads/Inbox recovery and keyboard behavior. A dedicated synthetic browser preview now exists; [PREVIEW_QA.md](PREVIEW_QA.md) records checked sample workflows and remaining findings. Full browser and live-provider verification are separate release gates.

Remaining work includes shared route/MCP cleanup, granular capability declarations, full metric/provider-operation coverage beyond the current stored account-level Analytics inputs, complete Facebook media and Ads lifecycles, legacy capability parity, comprehensive Root configuration coverage, complete MCP parity, design/browser checks, production-shaped data/permission checks, live provider verification and cleanup, migration/rollback rehearsal, and rebuild deployment.


## Root diagnostics and module operations — 2026-10-16

`server/root/diagnostics.ts` is the private shared UI/HTTP/MCP service. `/root/operations` contains Shared infrastructure checks; each installed product/platform settings screen contains its own diagnostic history, safe results and sidebar run controls. Scope IDs derive from installed manifests. Provider connection choices are bounded to the chosen platform, and exact IDs can be tested through HTTP/MCP. Root may test installed platforms before enabling customer access. No arbitrary URL, script, tool name or provider write is accepted.

The service rechecks active installation authority, requires `RUN DIAGNOSTICS <scope>`, acquires a PostgreSQL advisory transaction lock per scope and records a start before preparing checks. Cooldown spans owners, interfaces and connection choices. Unconfirmed starts block retries until recovery; each start retains a recovery floor at least its original total deadline plus two database timeouts, so later shorter settings cannot permit early overlap. A total preparation/check deadline cancels provider requests, marks the active check failed and skips remaining checks. Database probes/audit transactions have separate statement/transaction bounds; not all background read promises are cancellable at the database driver. Returned outcomes are preserved with a warning if completion auditing fails. History retains started-but-unconfirmed runs explicitly; it does not label them successful.

`server/diagnostics/checks.ts` owns neutral configuration validation, database reads, in-memory authenticated encryption, media-directory permission checks and replacement worker activity. Product checks validate only their owned configuration and job evidence. `platforms/facebook/diagnostics.ts` owns OAuth setting presence, selected-source expiry/revocation, authenticated identity comparison, current requested grants and read-only Page/ad-account discovery. These checks reuse the configured adapter transport, combined per-request/suite cancellation and pagination limits; they neither persist discovery nor change provider data. Success counts only the returned bounded discovery set. A pass is not proof of callback registration, every selected resource, publishing, media, inbox delivery or spend-changing access. Preview credentials/endpoints are synthetic and deliberately fail remote reads.

Product manifests now declare background job names, labels and schedule keys, shared by the worker and Root health. The Root-managed `jobs.order` preserves the previous dispatch priority by default; unlisted installed jobs follow in manifest order. `root/operations.ts` reads replacement-only run history and heartbeats in the persisted `rebuild-` identity namespace, projects enum outcomes/timestamps/durations/error-presence and omits stored raw errors, summaries and hostnames. It never interprets shared jobs as provider-specific telemetry. UI/API/MCP use this same current-Root-checked service. No-job modules say checks are skipped rather than inventing worker evidence. The old mixed legacy/rebuild latest-job read has been removed.

Registry version 35 supplies diagnostics availability, cooldown, incomplete-run recovery, total check deadline, database timeout, bounded history, operational timezone and recent-run/stale-heartbeat controls. Explicit timezone formatting avoids server/browser hydration disagreement; ISO HTTP/MCP timestamps remain UTC. Other Root date screens have not all adopted this preference. At that batch, private MCP had ten tools/six resources, including operations and diagnostics; the deletion-recovery addition below expands that inventory. Workspace bearer keys remain excluded.

This batch adds no application migration. The existing worker migration was missing from the isolated preview; it was applied there only after a local custom-format backup was restored and aggregate fixture counts matched. No worker was started and no production service or schema changed. Full platform-operation diagnostics, remote live-provider evidence, broader legacy operator controls, product encapsulation and production cutover gates remain unfinished.

## Inbox stored activity browsing — 2026-10-16

Inbox list/thread reads now live in `modules/inbox/server`, shared by the page, new no-store HTTP read routes and MCP `list_inbox`/`get_inbox_thread`. The former duplicate overview and MCP ORM lists were removed. Services recheck current active account, membership, entitlement, feature permission, workspace state and selected Inbox-capable channel visibility; key limits intersect current member grants. The Inbox shell now explicitly accepts this scoped reader path. Stable filter-bound tuple cursors support both directions, literal message/person search and separate history continuation without old 50-per-type/300-history truncation. Latest inbound reply eligibility is independent of the shown window. Counts and coverage copy say stored activity.

Registry version 36 adds Inbox-owned page/search/cursor bounds consumed by services and sidebar controls. The UI preserves list position, history position and selected conversation where valid, with distinct reset/empty/error states. A guarded synthetic 54-message fixture supports local browsing checks. No migration or remote provider operation is part of this batch. See PREVIEW_QA for evidence and remaining UX/provider/MCP gaps.

## Shared form behavior — 2026-10-16

The design layer now owns reusable field validation/focus (`components/FormValidation.tsx` over `lib/ui/form-validation.ts`) and multiline behavior (`components/AutoTextarea.tsx`). These helpers contain no provider branching or server authorization policy. Mutation forms use native metadata plus explicit domain checks; server/API services remain authoritative. Existing GET/action entry points declare server-owned validation rather than browser message bubbles. Form control changes do not add configuration, persistence schema or provider operations. Account password checks retain the provided UTF-8 byte policy; one-time MCP token display defaults to masked with explicit reveal/copy. Current verification and open cross-screen/browser limitations are in PREVIEW_QA.

## Inbox local workflow and write boundaries — 2026-10-16

`modules/inbox/server/access.ts` now owns shared current-identity/feature/channel authorization for reads and local workflow. `workflow.ts` owns validated resolve/reopen with a scoped update and matching legacy-named domain audit in one database transaction. This product-local operation no longer belongs to the Facebook host or requires live provider credentials. UI exposes local workflow independently of remote reply/moderation readiness; HTTP and MCP share the service, and MCP intersects its caller channel constraint. Only the service acquires the workspace operation lock, and it refreshes grants after the lock wait before opening the local mutation transaction. HTTP/MCP transport wrappers explicitly skip their generic lock for this operation, avoiding a nested-lock queue deadlock against purge/suspension.

Inbox action HTTP now masks unexpected errors through the shared typed boundary and returns no-store for all outcomes. Non-sync service receipts must explicitly confirm success. The client refuses malformed/missing/false receipts, validates displayed sync counts/timestamps and retains text/dialog context with honest unconfirmed-outcome copy. These are safety boundaries, not a durable remote operation journal. That batch introduced no schema change. The subsequent durable deletion batch below adds the journal, recovery, tombstones/lifecycle integration and MCP deletion; INBOX_WRITE_RECOVERY.md tracks remaining automatic/provider verification gaps.

Registry 37 adds Inbox-owned local transaction duration/acquisition bounds consumed by resolve/reopen; existing Shared controls still govern its workspace lock. No provider protocol timing is introduced into shared product logic.

## Durable Inbox deletion and private recovery — 2026-10-16

`modules/inbox/server/deletion.ts` now owns committed deletion intent, unique remote-resource claims, scoped status and atomic local finalization/audit. The Facebook host exposes credential-checked `prepareDeleteComment` returning a cancellable provider-only dispatch; local deletion/audit orchestration no longer belongs to Facebook. Non-rejected journal entries act as tombstones. Durable alias IDs preserve status after cleanup; recursive scoped descendant IDs and parent-first ingestion suppress stale descendants across sync windows. A shared fail-fast channel lock orders comment deletion/replies/moderation, manual/worker persistence and disconnection. The shared workspace guard remains single-owned by deletion services; HTTP/MCP skip their generic wrapper for these operations. Current grants are refreshed after acquiring locks.

UI/HTTP/MCP share status, initial deletion and provider-free local recovery. Private Root Inbox recovery exposes bounded safe history and explicitly manual operator attestation through UI/HTTP/MCP, distinct from automatic provider verification. Workspace keys cannot reach private Root operations. Registry 38 owns comment operation budgets, private history bounds and preserve-until-erasure policy; incompatible lock budgets fail before dispatch. Disconnection and workspace erasure refuse unresolved journal states; workspace exports intentionally include FK-owned recovery records. The reviewed additive table preserves resource identity without credentials/content and has no target/user FK.

See INBOX_WRITE_RECOVERY.md and PREVIEW_QA.md for current evidence and limits. Complete provider reply discovery, automatic remote verification/rejection classification, delayed effects after cancellation, complete Inbox parity, live Facebook deletion tests and full migration/cutover verification remain open. Production remains legacy.

## Shared Analytics explorer and comparison reads — 2026-10-16

`modules/analytics/server/read.ts` now provides the current-authorized snapshot used by the scoped page, no-store HTTP, CSV and workspace MCP tools/resource. Provider normalization stays inside Facebook; shared catalog inputs carry exact covered resource IDs and provider aggregation notes/labels. Strict UTC calendar ranges, resource selection, search and full detail continuation replace route/MCP forks. Root registry 39 owns read and presentation limits. The sidebar contains all report controls; cards retain bounded, explicitly labelled chart previews and full detail tables remain reachable. Reach overlap and latest-day rate coverage are explicit.

The duplicate raw `get_page_analytics` MCP path was removed following an exact-ID/scope overwrite finding; remaining Analytics tools use the shared service. [ANALYTICS_READS.md](ANALYTICS_READS.md) describes semantics, interface/config ownership and current performance/provider/UX limitations. [PREVIEW_QA.md](PREVIEW_QA.md) records synthetic local evidence. Complete analytics/legacy parity, live provider verification and production cutover remain open.

## Publishing operation authority and recovery UX — 2026-10-16

`modules/publishing/server/access.ts` and `guard.ts` own current service authorization, caller/channel intersection, the single workspace operation boundary, post/destination exclusion and whole-operation cancellation. All lifecycle and unconnected-draft mutations use this boundary; thin UI/MCP/worker callers skip their duplicate workspace wrappers. Local writes and domain audits share bounded transactions. Worker publication requires the same scheduled state/timestamp observed by its candidate scan. Connection removal shares destination locks, and cleanup refuses unresolved publishing/Inbox/post-deletion evidence. Registry 40 exposes the consumed Publishing operation budgets; registry 42 adds consumed post-deletion history and alias bounds.

Shared Publishing now asks adapter credential-readiness metadata for status sync; Facebook owns the configured scope rule and combines the neutral signal with its per-request timeout. Inline edit/delete use stateful actions retaining values/choices and focused feedback after failures. Actual Chrome success testing found and fixed swallowed Next redirects. [PUBLISHING_OPERATIONS.md](PUBLISHING_OPERATIONS.md) records the earlier guard work and evidence. The later post-deletion journal closes the missing durable remote-delete receipt path, but does not prove provider behavior, full publication recovery, selected-resource reads, provider formats/grants/live verification or complete parity. Production remains legacy.

## Separate first-comment receipts — 2026-10-16

The subsequent first-comment batch separates adapter post creation from comment dispatch. Shared Publishing commits its remote post receipt before the Publishing-owned comment service claims an attempt. Existing legacy comment ID/timestamp/error columns provide durable attempt evidence; ambiguous results cannot be automatically resent, while recognized adapter rejections permit an explicit retry. UI and MCP expose normalized per-destination states, explicit sending and audited external human attestation. Root registry 41 adds the consumed Facebook first-comment scope policy and OAuth/readiness integration. [FIRST_COMMENT_DELIVERY.md](FIRST_COMMENT_DELIVERY.md) defines state, ownership, local proof and remaining gaps. This closes the combined post/comment receipt-loss defect when the post receipt successfully commits; it does not recover a post receipt lost before commit or complete durable remote deletion. No DDL or production change was made.

## Durable Publishing post deletion and recovery — 2026-10-16

`modules/publishing/server/deletion.ts` now commits content-free remote identity intent before dispatch, records confirmed or uncertain outcomes, and atomically finalizes local removal and audits only after required remote confirmation. Provider exceptions remain uncertain; there is no automatic provider verification or retry. Per-destination receipts preserve partial success. Status, delete, finish, and externally verified outcome recording share the Publishing service across UI and workspace MCP. Private Root UI/HTTP/MCP provides bounded history and explicit human attestation. Local post/destination aliases support status after cleanup and cleanup of duplicate references; non-rejected identities remain tombstoned until workspace erasure. Normal mutations and worker status sync cannot resuscitate those remote identities, and cleanup refuses unresolved evidence. Registry 42 provides consumed bounds for Root history and per-operation aliases.

The fourth additive migration is pinned in the cutover verifier and was applied only to the isolated preview after a restore-verified backup; production was not changed. The backup at `/private/tmp/socialpilot-preview-before-post-deletion-20261016T210904Z.dump` was 244200 bytes, the exact source-table counts matched, and the migration restore matched 97 tables. This does not prove the full four-file rehearsal on a production-shaped baseline. The earlier publication receipt gap remains: accepted post creation with failed local receipt persistence has no equivalent journal. See [POST_DELETION_RECOVERY.md](POST_DELETION_RECOVERY.md) and [CUTOVER.md](CUTOVER.md). Provider/live checks, broad capability parity, full migration rehearsal, production backup/media recovery and rollback remain release blockers.

## Shared selected-resource Publishing reads — 2026-10-17

`modules/publishing/server/read.ts` now owns current-authorized post pages,
calendar range reads, bounded MCP lists, HTTP pages and Home publishing counts.
`read-scope.ts` resolves selected non-revoked enabled publishing-capable resources
through neutral adapters and platform entitlements. Expired credentials and
removed write readiness do not hide stored history. Destination-bound posts
must have every destination in the resolved current scope, preserving the
existing conservative whole-post permission rule. Unconnected-draft visibility
retains the unrestricted-workspace versus scoped-author distinction. Counts and
pagination share the same predicate; the unused unscoped post/calendar helpers
were removed. Thin customer routes, MCP and no-store Posts HTTP use this service.

Registry 43 exposes consumed page, list and calendar bounds. Sidebar and composer
choices use the same resource resolver. Unavailable URL selections remain
explicit and return no matches. Shared drawer Escape handling respects an open
native select before closing navigation. This closes the previously observed
retained unselected post leakage in normal Publishing views and Home counts;
it is not a complete retained-data archive UI or Publishing parity claim.
See PUBLISHING_READS.md and PREVIEW_QA.md. PUBLICATION_RECOVERY_PLAN.md is
the original design for publication recovery; the later implemented journal/manual recovery is described below and in PUBLICATION_RECOVERY.md.


## Durable publication attempts and local recovery — 2026-10-17

Publishing now owns content-free publication intent, independent remote receipt
persistence and atomic local projection/audit. Existing intent never dispatches
again; uncertain outcomes remain held. Current-authorized customer HTTP/MCP
and private Root services expose explicit external human attestation, legacy
processing adoption and local-only finish. First comments remain separate and
start only after the post receipt is projected. The fifth additive journal
migration has strict NULL-safe state constraints and retains claims through
projection. Registry 44 owns consumed publication history and URL bounds.
Cleanup guards preserve unresolved journal evidence independently of legacy
status rows. See PUBLICATION_RECOVERY.md and PREVIEW_QA.md for evidence and
limits. No automatic provider reconciliation, live provider proof or production
cutover is established by this batch; those release requirements stay open.

## Publishing readiness and photo identity — 2026-10-17

Registry 45 adds consumed, nonempty Facebook publish/delete grant policies
owned by its module. Shared Publishing resolves locally current decrypted
credentials and adapter readiness before publication intent, first-comment
dispatch, remote deletion or manual status sync. Facebook repeats operation
grant checks before transport. Composer/edit/import and bounded MCP destination
tool/resource output share current readiness, including product availability;
recorded capability alone is insufficient. Tokens remain server-only, and
retained selected history follows read authorization independently of grants.
Single-photo receipts prefer an explicitly valid provider post identity rather
than its photo identity. PUBLISHING_READINESS.md records ownership, local proof
and limitations. No DDL, live provider verification or production change.

## Installed platform workspace access — 2026-10-17

Each platform manifest declares its Root default-inclusion and plan-grant
policy keys. `platforms/access.ts` resolves only installed modules against
their registered validated defaults/current values and installation enablement.
Unknown plan provider IDs never install/grant a provider. Invalid or encrypted
policy values fail closed. Registry 46 adds consumed Facebook-owned workspace
access controls; Facebook remains included by default. Shared entitlements no
longer name Facebook or infer providers from arbitrary plan strings.

Normal web and all MCP workspace contexts explicitly deny suspension inspection;
the entitlement loader also defaults to denial. Installation-owner authority
alone cannot restore customer access to a suspended workspace. Private Root
session authorization and its own inspection/restore services remain separate.
This supersedes earlier descriptions of an automatic workspace inspection
exception. Explicit internal inspection remains an opt-in loader contract.

Connection choices, OAuth start/callback and enabling discovered resources now
apply current platform access. Home/team/MCP destination lists, Analytics
provider loading, Inbox channel/actions/manual sync and Ads choices/reports/
actions use entitled-provider constraints alongside existing selected-resource,
tenant, role and feature rules. Local deselection/disconnection/data controls
retain their separate cleanup semantics. HTTP connection failures use typed
safe errors and no-store instead of matching raw exception phrases.

See PLATFORM_ACCESS_PLAN.md and PREVIEW_QA.md for actual local policy changes,
MCP/HTTP/browser checks, restoration failure testing and remaining boundaries.
This does not implement complete plan/billing administration, provider-owned
background collector plan gating, webhook lifecycle or full module/legacy/MCP
coverage. No migration, live provider request or production change occurred.

## Idempotent local post duplication — 2026-10-17

Publishing now owns authorized draft copying in
`modules/publishing/server/duplicate.ts`. Shared UI/HTTP/MCP entry points use
one service and one workspace/source/destination guard. Current whole-post
visibility and author rules are checked before durable receipt replay; copied
content/media/first comments use the existing authoring and workspace image
validation. A UUID-bound draft and content-free domain audit commit atomically.
New destination rows are pending with no remote identity or delivery history.
Retries return the matching copy without overwriting later edits; changed
authority, collisions and deleted copies fail closed. No provider request, DDL
or registry change is introduced. POST_DUPLICATION.md records the exact
request/receipt contract and limitations. Bulk actions, complete Publishing
parity, live provider verification and production cutover remain unfinished.

## Shared Posts search and complete-or-refused CSV — 2026-10-17

Publishing's read-query service now owns current-authorized literal text/first-
comment, status and channel filters. Count/list, HTTP Posts, CSV and MCP share
its whole-post selected-resource predicate. The data page helper independently
conjoins its mandatory tenant/resource/author scope with richer filters. Search
escapes SQL LIKE metacharacters and uses the same configured UTF-16 bound as
native maxLength. Sidebar controls and pagination preserve applied filters in
Table, Feed and Cards. Typed validation failures retain useful focused feedback.

The Publishing-owned export service projects all content/media/first comments
and normalized delivery outcomes into CSV v1. Read-only HTTP/MCP use the same
service. Ordered keyset batches share a RepeatableRead snapshot and stop at
configured post/UTF-8 byte ceilings; oversized exports return no partial file.
Registry 47 adds consumed search/export row/byte/batch limits under Root's
Publishing controls and reuses its transaction duration/wait settings. No DDL
or provider request is involved. POST_SEARCH_EXPORT.md records the protocol,
permission/UX boundaries and open performance/asynchronous-export/legacy gaps;
PREVIEW_QA.md owns actual evidence. Production remains legacy.

## Facebook signed transport and live read sample — 2026-10-17

Registry 48 adds consumed Facebook-owned `meta.appSecretProofEnabled`, default
true, using the existing encrypted app secret. The Facebook engine signs Graph
GET/DELETE, form/multipart POST and each paginated read; the separate ad-set
transport signs campaign reads and creation. Pagination validates its endpoint
before replacing incoming credentials with the caller token and fresh proof.
OAuth browser/exchange protocols remain separate. Missing/unreadable signing
material preserves safe adapter metadata/stored history while denying write
readiness and failing before transport. Ads exposes a neutral host readiness
check used by shared live read/manage services and direct mutations.

The unsigned engine was rejected by the real app's proof requirement. The signed
exact bundle subsequently passed six read checks against the authorized host's
existing Graph v26.0 connection: identity/grants, 10 returned Pages, 5 ad accounts
and 24 observations across four configured Page metrics. This engine-only legacy
credential bridge changed no provider/database/configuration/service state and
does not prove rebuild configuration migration, live UI/API/MCP, publishing,
Inbox, Ads management or complete metric coverage. The observed connection lacks
`ads_management`. FACEBOOK_REQUEST_SIGNING.md and PREVIEW_QA.md record proof and
remaining limits. Production remains legacy; all cutover gates still apply.

## Ordered media authoring and adapter format metadata — 2026-10-17

Shared Publishing now owns one ordered attachment controller/editor used by
creation and local post editing. Complete lists, per-image descriptions, trusted
File previews and sequential confirmed-reference upload recovery replace the
single-item UI and multi-image edit exclusion. Strict action/MCP list parsers
reject bytes, client IDs and unknown fields. MCP create/update and destination
tool/resource metadata now cover the same ordered media service boundary.

Neutral `PublishingMediaSupport` declares supported kinds, optional count bounds,
combinations and descriptions. Facebook owns its declaration and transport checks;
shared validation no longer hardcodes its combinations. Current authoring,
duplication, scheduling/rescheduling and pre-intent publication validate adapter
support. Safe ready-only choices expose format/local-upload bounds and UI uses
their intersection with Root limits. The existing Root media-count label now
describes local references too; no new key or registry-version change occurred.

ORDERED_MEDIA_AUTHORING.md and PREVIEW_QA.md record real local checks/cleanup and
open browser/format/recovery work. No DDL, real provider operation or production
change occurred. This does not complete image-only authoring, local video,
intermediate photo journals, native formats, full MCP/provider parity or cutover.


## Captionless post content — batch 51, 2026-10-17

Shared Publishing now validates content after normalizing attachments: text can
be empty when a validated link or media is present. First comments are excluded
from that minimum-content rule. Creation, local edits, duplication, stored
scheduling/rescheduling and publication preflight use the same rule and current
Root character/media limits. Empty stored posts are refused before new publication
intent. CSV and text-only local draft helpers still require text.

Customer forms accept pending local image Files, then run the existing upload
and compatibility checks before save. Shared previews omit absent captions;
Posts/Calendar use one neutral safe content summary. MCP requires an explicit
string `message`, permitting `""` with content, and dispatches through the same
services with existing confirmation/permission/audit boundaries. No provider
branch, setting, migration or schema change was added. Facebook's existing
engine already omitted blank caption fields; new transport fixtures cover image,
remote video and link posts without filler text. CAPTIONLESS_POSTS.md and
PREVIEW_QA.md record evidence and remaining browser/live-provider/release gaps.


## Facebook media steps and module-owned Root evidence — batch 52, 2026-10-17

Facebook now owns a content-free photo/feed step journal, pure persistence port,
engine sequencing and private evidence schema. Configured engines/adapters inject
it and require the shared opaque publication operation ID for multi-photo writes.
Each intent/receipt commits independently before the next remote phase; unresolved
steps are never resent. Only a committed first-photo definite rejection can
release the parent without earlier effects. Later/ambiguous failures remain held.

Installed neutral recovery hooks guard new claims and data/connection cleanup
regardless of customer enablement; manual outcomes cannot contradict known feed
receipts or abandon staged/unknown uploads. The narrow safety registration avoids
constructing provider API engines in shared guards. Root's generic module panel,
sidebar operation filter, private GET API and installation MCP tool/resource share
active owner checks and module-owned safe evidence. Workspace keys cannot read it.
Registry 49 adds consumed Root/platform evidence limits. The sixth additive SQL
migration was applied only after restore verification on the synthetic preview;
CUTOVER.md records the unchanged checksum and exact backup counts.

FACEBOOK_MEDIA_RECOVERY.md describes source ownership, state boundaries and gaps.
This is durable staging evidence and matching local receipt recovery, **not**
finished staged-photo cleanup, unknown-step reconciliation, live provider proof,
full module/legacy parity or cutover. Failed staging remains held until those
provider-owned recovery operations are implemented and verified. Production is
still legacy.


## Manual Facebook staged-photo cleanup — batch 53, 2026-10-17

Facebook owns an opt-in Root action, credential/read/delete transport and a
separate content-free immutable deletion journal. Shared Root exposes generic
module-defined confirmation/acknowledgment and HTTP/installation-MCP dispatch.
Workspace/target/post/current-owner locks and independent committed intent/audit
precede provider IO; a started parent is frozen before a late feed can begin.
Confirmed receipts replay locally; ambiguous results or receipt faults remain
held. Current parent bindings and projected identities are rechecked.

Registry 50 adds consumed provider-owned manual cleanup and read/delete scope
policies. Manual cleanup defaults off: a Photo read cannot prove continued
unpublished/unused state or make DELETE conditional, so Root must externally
verify and acknowledge that race for each action. Known/unknown feed effects
block cleanup. Existing data guards and ABSENT recovery incorporate confirmed
photo deletions without permitting unknown effects to disappear. The seventh
additive migration has restore-verified preview-only evidence in CUTOVER.md.

FACEBOOK_MEDIA_RECOVERY.md and PREVIEW_QA.md distinguish synthetic engine/DB/
HTTP/MCP proof from pending live browser/provider testing. Unknown-step/delete
reconciliation, broader Facebook/legacy/MCP parity and cutover remain unfinished.
Production is still legacy.


## Human media outcome reports and late provider evidence — batch 54, 2026-10-17

Installed modules may declare bounded typed fields and read-only resolved context
on a Root recovery action. Shared Root validates and renders the generic shape;
the module still owns field meaning, semantic validation, current-evidence checks
and its locked operation. The context is derived from evidence and is never sent
back as caller input. Root's evidence API and installation MCP action dispatch
remain private to the active installation owner.

Facebook now supports explicitly enabled operator reports for externally observed
photo/feed presence, step absence and photo deletion/presence. Reports append
content-free immutable resolution facts with human provenance; provider results
are appended separately with provider provenance. A human report is an assertion,
not a provider receipt or proof that a delayed request did not succeed. Conflicting
outcomes remain held; late provider evidence is retained separately. No generic
conflict-resolution control, candidate search, remote retry or automatic resend
is exposed. In particular, a human feed-absence report never authorizes destructive
cleanup. Cleanup requires no feed intent or a definitively provider-rejected feed,
in addition to the existing explicit unused-photo check and opt-in/race
acknowledgment. Resolution events are append-only during normal operation; the
authorized workspace-erasure flow may remove them with workspace data.

Registry 51 adds the consumed Facebook-owned
`meta.manualMediaAttestationEnabled` boolean, default false. Synthetic service,
database, HTTP and installation-MCP checks are not live provider proof. This
extends Root recovery evidence without completing photo/feed/delete reconciliation,
Facebook/legacy/MCP parity or cutover; production remains legacy.

## Bounded live multi-photo evidence — batch 55

The reviewed Facebook engine now has real host-only credential-bridge evidence
for two generated multipart photo uploads, ordered feed publication, published
status and exact photo/feed association readback, followed by an explicit feed
deletion receipt. It is not a rebuild runtime/UI/API/MCP or database-journal
integration test. Photo objects became unreadable afterward; their cleanup
remains held with private evidence and a per-Page canary lock. No absence was
inferred and no unknown write was retried. FACEBOOK_LIVE_MEDIA_CANARY.md records
the exact scope, immutable artifact hashes, pending verification and operator
tool. Production application/data configuration and all cutover gates remain
unchanged; this partial result does not complete the Facebook module.

## Ads report filter consistency — batch 56

Ads now owns the pure filter parser/preset catalog under `modules/ads`, consumed
by the existing report read boundary and shared sidebar form. Invalid selections
render field-linked correction state before insight/readiness work. They never
broaden into an all-account/default-period report. Selected-account counts and
visible cards agree, while the mandatory workspace/resource/provider intersection
remains enforced independently in the data query. Shared form primitives replace
the screen-specific input/button styling. ADS_REPORT_FILTERS.md records tested
behavior and the remaining Root catalog, report bounds/pagination and broader
Ads/MCP/parity gaps. No registry, DDL or production/provider state changed.

## Ads-owned reporting policy — batch 57

Registry 52 installs the strict atomic `ads.reportingFilters` definition from
the Ads product module. Public types/defaults, validation, runtime loading and
pure filter interpretation stay in that module; the central registry explicitly
installs its schema without putting executable schemas in client manifests.
Root's existing Ads controls own presets, labels, default, maximum calendar days
and filter-string limits. Invalid Root HTTP values now return actionable 400
feedback before persistence; saves keep the existing value-free audit boundary.

Both Ads routes and MCP consume one validated policy and shared UTC parser.
MCP can select/discover current presets, preserves documented partial-date
requests and marks its returned end exclusive. Empty/stale selections fail
without broader reads; mandatory workspace/resource/provider predicates remain
independent of filters. No adapter logic, DDL or production deployment changed.
ADS_REPORT_FILTERS.md and PREVIEW_QA.md record scope/evidence. General copy
configuration, report row bounds/pagination, status/freshness/comparison/export,
broader Ads/legacy/MCP parity and release gates remain open.

## Complete bounded Ads datasets and report pages — batch 58

Registry 53 installs Ads-owned `ads.reportPageSize` and `ads.reportMaxRows`.
The stored insight query reapplies current selected/enabled account/connection
scope and trusted normalized levels before fetching at most the ceiling plus
one. Over-limit reads fail before aggregation or returning partial results.
Both customer report pages and MCP use that same boundary and Root default size.

Ads paginates account cards or complete object summaries on the server after
aggregation; sidebar links preserve filters and counts identify the full selected
scope. Invalid page/paging input is refused before report reads. Current latest
object names and a lossless identity tie-break stabilize pages for unchanged data.
Typed page/limit failures preserve correction context; private policy failures
stay customer-safe. ADS_REPORT_FILTERS.md and PREVIEW_QA.md own detail and proof.
This is bounded synchronous aggregation, not database object pagination or a
cross-request snapshot. Byte/time bounds, asynchronous large reports, directory
paging, comparisons/export/freshness/status, full daily MCP details, broader
Ads/legacy parity and cutover remain unfinished. Production remains legacy.

## Stored Ads daily details and complete CSV — batch 59

Registry 54 installs consumed Ads-owned detail/export byte bounds and a safe CSV
filename. Current-authorized module services expose stored daily scalar metrics,
actions, additional fields and fetch provenance through HTTP/MCP, plus complete-
or-refused CSV. MCP has scoped daily tools/resource and a whole-export row cap;
customer read access does not grant management. Both Ads pages now explicitly
use the channel-scoped reader path. Daily expansions share a complete metric
presentation; existing raw-field views also apply the neutral credential scrub.

Publishing and Ads reuse one confirmed, stale-safe CSV download component. Root
policy controls limits and filename without source edits; typed invalid policy
fails closed. ADS_REPORT_EXPORT.md owns the protocol and documented redaction,
snapshot/performance and provider-coverage limitations. PREVIEW_QA.md records
actual evidence. These stored reads/exports do not complete Ads management,
Facebook/legacy/MCP parity or production cutover; legacy remains running.

## Workspace-qualified Facebook collectors — batch 60

Registry 55 supplies Shared owner-policy/resource-lock controls and Facebook-
owned Page insight grants and collection lookbacks. The neutral job access
service implements the user's any-active-owner decision with same-owner feature
and platform access and no installation-owner suspension exception. Customer
per-member authorization remains unchanged.

Facebook's four collectors refresh authority, selected bindings, credentials,
grants and expiry under resource locks at dispatch/retry and persistence
boundaries. Selection, disconnection and reconnection share those neutral locks;
transaction-scoped writes fence late responses and update counts follow commits.
Provider IO, granted-scope names and mapping remain inside Facebook. See
WORKER_WORKSPACE_ACCESS.md for semantics and non-instantaneous policy-change
limits, and PREVIEW_QA.md for actual evidence. No migration, live provider test
or production cutover is established by this batch.

Workspace team access, batch 61: the Settings module owns the shared team service, typed Root bounds/defaults, customer UI, HTTP route and MCP tools/resource. Directory and mutations recheck current user, membership, role, permission, feature and tenant scope; channel grants must target enabled resources within the entitled workspace. Serialized transactions keep membership, grants and domain audit atomic and preserve an active owner. Owners/admins receive all channels; owner-role assignment is owner-only. See TEAM_ACCESS.md.

Workspace invitations and account onboarding, batch 62: the Settings-owned invitation service uses the existing legacy table through bound SQL, with no schema migration. Root registry 57 supplies five invitation bounds/switches and 14 shared SMTP mail controls. Customer UI, HTTP and management MCP share scoped invite/list/revoke service operations; public preview, acceptance and registration are HTTP flows. Hashed single-use fragment tokens, encrypted short-lived continuation cookies, exact confirmations, current inviter rechecks, lock-serialized transactions and atomic membership/audit updates constrain the flow. New accounts cannot overwrite existing users and receive no session; normal sign-in applies MFA. Ordinary roles start with no channel access; privileged roles require current Root MFA enrollment policy. See ONBOARDING.md. Preview SMTP capture verified the full HTTP/Root/MCP and PostgreSQL path, but clean phone/browser flow, full legacy parity and production cutover remain open.

## Templates, Inbox productivity and workspace publishing policies — batch 63

Publishing owns reusable template CRUD and composer reuse of message, hashtags,
first comment and a workspace label. Inbox owns scoped assignment, private
notes and saved-reply CRUD; choosing a saved reply fills the draft and never
sends it. Settings owns workspace time zone and contributor approval policy.
UI, HTTP and MCP dispatch through their shared module services, with current
permissions, tenant scope, exact confirmations and atomic domain audits.
Registry 58 adds consumed module settings and bounds. Existing legacy tables
are reused; no DDL or production change is implied. Approval metadata is cleared
when approved content is edited; managers retain their existing bypass.
See CORE_WORKFLOWS.md for coverage and remaining release evidence.

## Labels, account recovery and Analytics explorer — batch 64

Publishing labels use the legacy label relations with scoped CRUD, association
counts, guarded cascade consequences and shared HTTP/MCP domain operations.
Workspace-wide changes require all-channel authority and refuse corrupt foreign
references. Settings account recovery uses hashed one-use email tokens, cheap
validity preflight before password hashing, active-account locks and atomic token
consumption/password update/session revocation. It preserves MFA and issues no
session. Public recovery has no workspace MCP identity and is not exposed as a
workspace tool. Analytics metric exploration uses the existing normalized reader
with selected-resource scope, strict filters, paginated series and provenance.
Registry 59 installs the corresponding module-owned operational policy. Root
feature availability, permissions, manifests and MCP resources use canonical
labels/explorer feature IDs. No DDL, provider write or production cutover occurs.
See PUBLISHING_LABELS.md, ACCOUNT_RECOVERY.md and ANALYTICS_EXPLORER.md.


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

## Ads creation integration — batch 75 in progress

Campaign/ad-set creation now shares Ads intent journaling, payload-bound replay,
current resource locks and recovery. Root registry version 68 adds Facebook-owned
`meta.adsCreationUi`, with validated supported-choice subsets/defaults and name
ceilings consumed at preview and dispatch. Exact confirmation templates stay
adapter invariants. Generic creation metadata is consumed by UI and MCP; no
provider objective rules belong in shared code. Static Claude review requested
reload-safe request identities and clearer pre-dispatch errors/history labels;
those fixes and browser evidence remain open. Local migration backup/restore,
three PostgreSQL ledger tests, isolated build/typecheck and 2222 passing tests
(108 skipped) precede these pending fixes. Production remains legacy.

Batch 75 verification update: the isolated Ads creation runtime passed 2346 tests
in 291 files (no skips), guarded local HTTP/MCP creation recovery with exact
fixture/settings cleanup, and production build/typecheck. Chrome verified phone
validation/dialog/reload hold behavior without a provider write, desktop two-rail
layout, and themed controls. Final shared button/color corrections passed 25 focused UI tests and a
separate production build/serial typecheck. The previously requested reload/no-dispatch fixes are
implemented and regression-tested; unrelated unfinished feature modules remain
excluded. Registry 68 is consumed by creation options and current provider checks.
See ADS_PARITY.md for exact proof and remaining live/provider/release limits.

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

## Tasks review corrections — batch 78

Independent Claude review completed after credits were restored. Two concrete
findings were fixed: feed-linked post erasure previously attempted a purge-gated
UPDATE, and Tasks writes nested multiple connection-holding transactions. Erasure
now orders dependencies through intermediate tables, deletes feed items after
posts, and never bypasses purge guards. Tasks uses one transaction; the MCP host
does not wrap it again. Purge state is read in a fresh statement after acquiring
the workspace lock. Updated edit/status timestamps use clock_timestamp().

Isolated source passed 2,435 tests / 299 files with no skips, production build
and serial typecheck. Six additional actual PostgreSQL tests passed single-pool
create/checklist/comment, simultaneous optimistic conflict and purge refusal,
with verified cleanup. A real feed-erasure regression reproduced the old 55000
failure and verified foreign sources/items/posts survive the corrected deletion.
The guarded actual HTTP/MCP/export/erasure probe passed on an isolated localhost
preview; fixtures and exact captured Root settings were restored. An initial
probe refused because no local server was listening; no fixtures were written.

No migration/provider/production change. Optional optimistic tokens, plan/key
revocation races, legacy schema drift and broader configuration coverage remain
open. Agency is a separate unfinished integration and was excluded from this
fix snapshot and commit. Production/socialpilot-deploy remain legacy.

## Agency host integration — batch 77

Agency is a registered module at /agency and /agency/clients, with Root registry
70, nine active settings, grouped plan grants and manager-only read navigation.
Context sidebar owns pages/filters; no third menu. Every workspace and metric
group is scoped to current access; disabled groups are withheld with coverage.
Search matches workspace names before the Root scan cap and cannot infer client
associations. Workspace switching reuses the session selection API. Suspended
metadata still requires Agency plan/switch grants, with all metrics withheld.
Installation disable applies before reads, and anonymous API requests return401.

Isolated evidence: 2,490 tests / 305 files (no skips), production build and serial
typecheck. Actual local production-build HTTP/MCP/PostgreSQL/hydrated Chromium
probe passed tenant/key/policy/page/selection assertions with exact settings and
fixture/audit cleanup. Chrome also verified two sidebars, phone no-overflow,
sidebar no-match/reset, Escape focus return and offline/online retry. Four
temporary theme color renderings were restored. See AGENCY.md for precise limits.

No person-wide MCP credential/tools are enabled: workspace keys cannot expand
across tenants. Complete Agency writes/pagination/scale, remaining legacy source
integrations, full Root technical controls, Facebook live coverage and migration/
rollback/cutover remain open. Production and socialpilot-deploy remain legacy.

## Atomic review participation and sharing schema foundation — batch79a

reviewPost accepts an optional provider-neutral before/after participant that
uses the same local Publishing transaction as approval and audit. Callback failure
rolls back the complete local operation; authority/target/abort guards remain.
This enables client feedback integration without embedding Sharing rules in
Publishing. It does not remove broader Publishing guard pool nesting.

Isolated foundation passed 2,509 tests / 307 files, production build and serial
typecheck. Five actual PostgreSQL tests verify participant persistence/rollback/
competing reviews with outer authority ports stubbed. An additive nullable
share-link expiry column was backup/restored and applied only locally, with
104 original table counts/settings/share contents preserved. Fourteen SQL files
passed schema-only rehearsal. Public Sharing host/UI/security verification is
still in progress and excluded from this foundation snapshot. Production and
socialpilot-deploy remain legacy. See CUTOVER.md and AGENT_HANDOFF.md.


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


## Reports host integration — batch82

Analytics owns the complete report workflow service boundary in
`modules/analytics/reports`; host `modules/analytics/server/report-workflows.ts` assembles
shared Analytics generation and transactional mail. `/analytics/reports`, thin
HTTP routes, six authenticated MCP tools and three resources share these rules.
A distinct manifest job and consumed Root registry74 controls govern delivery,
choices and bounds. The existing Analytics CSV exporter remains separate.

Manual downloads use payload-bound retained receipts and current authorization.
Scheduled sends use fresh one-at-a-time claims, lease fencing, per-recipient
intents, authority checks and uncertain outcomes without resend. Maintenance
locks workspaces before report rows and skips erasure. Legacy templates,
schedules, recipients and aiRecap are preserved by two additive migrations.

Final isolated suite:2865 tests/331 files, zero skips; build/serial typecheck.
Actual local API/MCP/Chromium/ZIP export/erasure, nine PostgreSQL cases and
schema-only SMTP capture passed, including final fixes. All disposable data and
settings cleaned/restored; insert-only synthetic review examples remain by intent.
17 migrations passed schema-only rehearsal; this is not production-shaped
migration/media/service rollback. Both Claude accounts contributed independent
reviews; findings were corrected and verified. See REPORT_WORKFLOWS.md.

Response-time, top-post and goals report sections now exist (wave 2; Goals also has
/analytics/goals, API and MCP). Destinations section and JSON export added
(REPORT_WORKFLOWS.md). Media library: MEDIA_LIBRARY.md; composer AI assist:
AI_ASSIST.md; RSS feeds: FEEDS.md; webhooks and REST v1: INTEGRATIONS.md (registry 85). The AI recap section and business-hours response time now exist; per-member
response breakdown and resolve time remain incomplete. Whole-tree design audit, full Facebook formats/live coverage, Root
coverage and other legacy integrations remain open. Production stays legacy.


## Batch85: per-destination publishing intent

New post targets persist their module-declared format separately. Shared lifecycle, queue, automation, duplication, versions, CSV and MCP validate and preserve this intent; existing null targets retain their historical global fallback. Composer and edit use one shared sidebar control and a native reset-preservation hook. See DESTINATION_FORMATS.md. Facebook still exposes only its implemented feed format; native formats remain unwired.


## Batch86 authoring acknowledgement

Stateful post creation returns a typed committed-success destination, followed by client navigation and an accessible fallback link. This avoids the observed completed303/pending-composer behavior. Post-commit cache refresh cannot be reported as failed creation. Browser save/retry now passes all four themes at desktop/phone widths; the full goal and production gates remain open. See DESTINATION_FORMATS.md for scoped evidence.


## Batch87 native transport and Root policy

Signed Facebook-owned Graph/resumable transport and registry76 native controls are implemented. Twenty-five native settings are grouped under Facebook and labelled configured; customer dispatch remains unwired. A local Root diagnostic validates one native configuration snapshot and cross-field limits without provider requests. The private constructor refuses missing required signing material. Real loopback HTTP tests verify encoding/signatures, response bounds and timeouts. See FACEBOOK_NATIVE_TRANSPORT.md. Root phone verification identified a long-search-heading overflow; shared settings heading/key wrapping fixes it.

The full objective stays active. Do not register the unscoped SQL proposal or treat this transport as complete native delivery. Keep the existing parent publication journal as the sole claim authority; next implement tenant-bound child phase receipts, payload identity/fencing, export/erasure and PostgreSQL concurrency checks, then native dispatch/status/comment/deletion and live cleanup. Production and the held photo-cleanup canary remain unchanged.


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


## Batch90: native status observations stay separate from proof

The private Facebook status scaffold now requires an explicit final identity,
keeps both Story formats unsupported for Video reads, snapshots polling inputs,
validates Root registry bounds, copies field arrays and supports per-read
cancellation through signed transport and polling waits. Staged identities are
not promoted by status, first-comment or delete helpers. Scheduled/failed status
observations do not confirm publication or release known remote objects.
Reconciliation keeps incomplete work held, requires explicit true update receipts
and rereads durable outcomes when possible. Cancellation gates new sends while
preserving explicit remote receipts already returned.

Isolated synthetic PostgreSQL suite:3082 tests/351 files, zero skips. Production
build and serial typecheck passed. Actual loopback HTTP tests prove stalled-body
read cancellation and successful subsequent requests. Both Claude accounts supplied
independent source reviews; a lower-cost builder/reviewer helped implement and
check the fixes. No UI/browser, migration, live Meta or production change occurred.
Native customer formats remain unavailable; the full goal remains active.

Next implement the identity-bound, audited native read-proof/recovery writer and
canonical host/status/comment/deletion services, then scoped API/MCP and cleaned
live provider evidence. See FACEBOOK_NATIVE_STATUS.md and
FACEBOOK_NATIVE_JOURNAL_PLAN.md. Existing Root evidence is not native resolution.
Preserve production and the held photo-cleanup canary. Broader parity/configuration
and production-shaped migration/media/service rollback gates remain required.


## Batch91 — private native status proof recovery

The private, default-off Facebook recovery path now records provider-owned
identity/Page observations in an append-only proof ledger. Exact final Video/Reel
identity, current credentials/configuration and Page authority are checked before
GET; current authority and displayed revision are checked again before acceptance.
Revoked pre-GET authority returns an audited unknown without issuing a GET.
Parent-first fencing, confirmation, atomic audit and installed outcome/erasure
guards require accepted proof at the current revision. Parent publication outcome
remains separate from child evidence. The Root action is shared by Root UI, API
and installation MCP; workspace clients receive no Root authority. Proof rows
contain no content, and evidence remains inspectable while the platform or
recovery flag is disabled. Registry77 keeps recovery default-off.

Migration20 (`20261019040000_rebuild_facebook_native_status_proofs`, SHA256
`253e8fb4f18b4cf60fcce16702772dd166358e641fb875c2781cb84d8dc767d4`) was applied
locally only after full backup and scratch-restore verification. The complete
20-file schema-only backup/restore rehearsal passed; 106 prior table counts and
settings were preserved, with the proof ledger as table107. This is not a
production-shaped service, media or customer rollback rehearsal. The full suite
passed 3,136 tests across 355 files with zero skips, including 26 actual
PostgreSQL journal/recovery cases (14 + 12); production build and typecheck passed.
Both Claude accounts reviewed the source and their findings were checked.

The built-server HTTPS-mock plus Root API/MCP probe passed access denial,
confirmation and evidence-visibility cases, with exactly two GETs: accepted
published proof from browser and scheduled/held observation from MCP. Eight
views covered four themes at 1440px and 390px. Screenshot review caught and fixed
Cancel wrapping at390px. The final build/typecheck and complete eight-view probe
passed again, including the one-line Cancel check and corrected phone inspection. No live Meta request or production change
occurred. Native customer formats remain unavailable; Story, remote deletion,
first-comment, canonical host integration, live provider coverage and
production-shaped rollback remain release gaps. See
[FACEBOOK_NATIVE_STATUS.md](FACEBOOK_NATIVE_STATUS.md).


## Batch92 — asynchronous provider receipt state

The shared publishing result now requires `state: 'published' | 'submitted'`.
Missing or unknown state, unsafe returned URL, and cancellation after a valid
provider receipt are held as durable `submitted` evidence and never projected.
Receipt-only persistence after cancellation is conditional on the original
parent remaining `started` and the bounded database write succeeding; it cannot
dispatch another provider request. If the parent resolved/was replaced or the
write fails, the service holds without projection. The original receipt time
and provider URL survive matching Root attestation; `attestedAt` records verification time, used by local projection. Known submitted IDs cannot be attested absent or replaced.
Projection rechecks provider outcome guards, including current accepted native
proof where required. General late-fact append/reconciliation for already-
resolved shared parents remains future work; Facebook's native journal retains
its own private late facts.

Migration21 (`20261019050000_rebuild_publication_submissions`, SHA-256
`91011f00b776d402038d74ff1862e5ab352bbeb500d386b5000172a17ffb5931`) preserves
the active claim and purge gate. Fresh full backup/scratch restore preserved
107 prior public table counts and Root settings; the file was applied only to
the synthetic local preview. The complete21-file schema-only rehearsal passed.
Actual PostgreSQL coverage passed native proof, matching Root attestation and
publication projection. Final suite:3,150 tests/356 files, zero skips; build/typecheck passed.
Root browser/API/MCP checks passed16 views across four themes/two widths and
exact-ID recovery/projection with two HTTPS-mock GETs. Both Claude accounts
reviewed source; receipt-retention findings were fixed and tested. All107 prior
counts/settings matched after cleanup; scratch removed and backup preserved.
Customer components are unit tested; full customer browser coverage is separate. See [ASYNC_PUBLICATION_RECEIPTS.md](ASYNC_PUBLICATION_RECEIPTS.md).

Facebook feed publishing currently returns explicit `published`; video upload
identity returns `submitted`, while video remains in the current media
descriptor. Native formats remain disabled. Automatic native host dispatch,
pending-status reconciliation, safe provider deletion, comment integration,
live-provider coverage and broader release gates remain open. Production and
the held provider canary remain unchanged.


## Batch93 — submitted status reconciliation

Shared UI, API and MCP status checks now reconcile durable submitted receipts
using positive provider reads. The adapter must echo the exact remote post and
channel identity. A submitted parent moves to provider receipt plus local
projection atomically; a failed projection remains submitted and repeats only
the read. The original receipt time/URL survive. Verification time is used when
the provider cannot establish publication time; Facebook video created_time is
upload time and is not presented as publication time. Unknown, processing,
malformed or mismatched answers leave the claim held. No create, first comment
or delete is dispatched by reconciliation.

Authorization, selected-resource binding, grants, token validity, transport
policy and current post format/content kind are checked again after the read.
The installed native-proof guard remains required. Shared code contains no
Facebook-specific status rules. The Facebook host includes a submitted-receipt
worker with an ordered, wrapping cursor, current qualifying-owner job access,
resource/post locks and a short final owner/settings/binding check. Root exposes
`meta.submittedStatusCursor` in Facebook Publishing recovery; registry78. This
is operational scan progress, not proof of publication or a feature switch.

Facebook status reads request exact identity/Page evidence for feed and video.
Ready plus explicitly published is required for a video. Graph100/sub33 is
unknown, never absence. Path-like remote IDs are refused before transport.
Official Meta SDK Post/AdVideo source confirms requested field names; Meta
developer documentation returned429 during research. SDK source and local mocks
do not establish live Graph version/permission behavior.

Final candidate passed3,176 tests/359 files, zero skips, including
actual PostgreSQL shared/worker reconciliation, mismatched identities, rollback
and format/media races; production build and serial typecheck passed. Both
Claude accounts completed bounded source reviews. Claimed scope/index/mapper
gaps were checked against the whole-post visibility predicate, existing partial
unique index and strict ready/published mapper. Identifier path validation and
video publication-time handling were tightened. These are source/local tests,
not live-provider proof. Built-server HTTP/MCP verification passed authorized API/tool reconciliation,
anonymous API and read-only key denial, and mismatched Page identity held.
Exactly3 local HTTPS-mock GETs and zero writes occurred; no live provider was
contacted. A test-only cursor cleanup defect was corrected and the complete suite
rerun. All107 table counts and exact Root settings then matched the backup;
scratch was removed and the full backup retained. The local preview now serves
batch93 against its original example database. No new browser matrix was run.

Fresh full backup and scratch restore preserved107 prior public table counts.
No migration was added or reapplied. Backup SHA-256:
`2719ef4181a86be0fd2fa11a305c6c57ea9ef0775751d4f346b1d7e10a2a6049`.
Production, the held photo canary and the current private native-format switch
remain unchanged. Full customer browser matrix, first-comment continuation,
automatic native host dispatch, safe deletion/live-provider evidence, broader
legacy parity and production-shaped rollback/cutover remain open.


## Delayed first comments (batch94)

The Publishing module now owns neutral due-comment scanning and receipt-safe
continuation through the existing posts job. Root controls delay bounds/cursor
(registry79); saved authoring, templates, versions, duplicate/recycle and exports
carry the delay. Automatic delivery requires both current qualifying-owner access
and the original author's own authority; UI/MCP manual send and recovery use the
same guarded service. Native formats remain disabled. Scope, migration22, local
evidence and remaining gates: [FIRST_COMMENT_SCHEDULING.md](FIRST_COMMENT_SCHEDULING.md).


## Batch95 — trusted media prerequisite

Shared immutable media inspection, public-source address-pinned fetching and a
private Publishing media-probe diagnostic are implemented. Registry80 owns the
consumed bounds/tool/temporary/download policy. Both Claude accounts reviewed
source; abort, redirect-header, compressed-response, metadata and rotation
findings were corrected. See [MEDIA_INSPECTION.md](MEDIA_INSPECTION.md).

This is not native host integration or release completion. Bind authorized
stored media and actual native upload bytes next; keep native formats disabled.
Production, its legacy deploy command and the held photo canary are unchanged.
Full goal remains active, including broader parity and production-shaped rollback.


Final local evidence:3,270 tests across368 files passed with actual synthetic
PostgreSQL and zero skips, grouped as3,264 tests/367 files plus the6-test global
submitted-worker file run separately. An all-files concurrent rerun exposed that
worker test selecting another file's temporary submitted row; separating the
global scanner from concurrent fixture writers avoids this test isolation
collision. It is not a new media or live-provider success claim. Production
build and serial typecheck passed. The real configured inspector and availability
check accepted a locally generated16x16,1-second MP4 and matched its byte digest.
Both Claude accounts and independent lower-cost agents reviewed the batch;
conservative duration and retained image concurrency permits were added after
review. No new browser/API/MCP or live Meta run was made in this batch; existing
diagnostic authorization tests passed through the shared service coverage.

Fresh full backup/scratch restore preserved107 table counts and exact Root
settings after final cleanup. No migration was added or reapplied; scratch and
synthetic video were removed, backup retained. Backup SHA256:
`277764d3a486b3138f1bef5e017966fc0c9cc2c6e6d5a28c86b3ff9e6e67b143`.
The final built preview uses the original example database at localhost:3200;
/sign-in returned HTTP200. Production and its held photo canary are unchanged.

## Media library usage and holders — wave 2 session B, 2026-10-19

`/publishing/media` and `GET /api/media` now show workspace image usage (files,
bytes, reclaimable unused images) and, per image, how many posts use it and which
ones, with not-yet-published posts first and links to each post. Posts are named
only within Publishing's whole-post visibility (`modules/publishing/server/media-holders.ts`);
scoped members see a count for the posts they can't see. En/fr copy:
`modules/publishing/media-library-copy.ts`. MCP image tools return the same counts
and name no posts until `server/mcp/server.ts` passes the holder visibility
(Session A edit). Evidence: unit tests; full suite 3,339/3,340 on a scratch copy
of the synthetic preview database (the single failure is the known
`config-validation` registry test already failing on main). No browser or
provider run. Still open: video library/imports, a storage quota, Connections
lifecycle callbacks and the remaining Ads report/export items.

## Connection token and permission health — wave 2 session B, 2026-10-19

`/settings/connections` shows per connection the credential state (valid, expires
soon within 7 days, expired, reconnect needed), the access end date, permission
areas in customer words (allowed / not allowed / not recorded) and a Reconnect
action for owners/admins when the credential or a needed permission is lacking.
Shared logic and en/fr copy: `src/lib/connection-health.ts`. The platform host
contract gains optional `connection.grantHealth`; Facebook implements it in
`src/platforms/facebook/connection-health.ts` by comparing stored grants with the
Root `meta.*Scopes` lists, so scope names never reach shared code. Status is derived
from stored data at render time, not a provider check; a revoked token appears only
once something marks it invalidated. Open: a Root setting for the warning window
(constant for now), a scheduled health check with a stored check time, re-requesting
declined permissions on Reconnect, MCP exposure, locale plumbing, browser check.
Evidence: unit tests and full suite (3,352/376) on a scratch synthetic database copy.

## Alert delivery branch — 2026-10-20

Settings durable notifications now receive Publishing lifecycle, connection expiry
and Inbox moderation/digest/spike producers; see [NOTIFICATIONS.md](NOTIFICATIONS.md).
The additive root Prisma migration is unapplied. Negative spikes depend on existing
classified sentiment; rebuild classification and live delivery/concurrency proof
remain open. Local branch-only commit requested; no push, servers or cutover.

## Stored per-module Root health (2026-10-20)

Installed product/platform declarations now opt into configuration validation,
job-history inspection and named stored queues. `/root/modules` groups health
under Shared controls, Product modules and Platform modules; product detail
screens show their own evidence. The existing Root operations HTTP/MCP service
also returns `moduleHealth` from the same current-Root-authorized service.
Inspection records `modules.health.inspected` with status metadata only. No
configuration values, run summaries, stored errors or provider requests escape
this boundary. Each job selects its latest rebuild run independently of the
recent-history page limit. Schedule-aware freshness uses worker timezone and the
existing worker stale grace, with a bounded one-day search; older sparse
schedules are unknown. Shared heartbeat, configuration validity, due publication
queues, held publication attempts and pending exports use stored evidence.
Platform publication queues are filtered by declared platform identity.

Missing/unattributed telemetry remains Unknown / Not available. In particular,
the existing global worker history does not establish provider-specific job
outcomes. Queue counts alone have no failure SLA; nonempty queues remain unknown.
This batch has mocked-service and server-render tests only; no browser, database,
live-provider or production verification is claimed. No keys or migrations.

## Historical demographics (2026-10-20, codex/demographics)

The demographics service now exposes full stored resource/date category snapshots,
with measurement/fetch times, period coverage and complete-or-refused CSV through
UI/HTTP/MCP. Facebook owns storage interpretation; the neutral Analytics catalog
and aggregator carry an optional history field. No new Root keys or migration.
See [module notes](../src/modules/analytics/demographics/README.md). Synthetic
unit/render evidence only; browser, real database/provider and release verification
remain open. This does not complete the other Analytics parity gaps.


## Channel organization slice (2026-10-20)

Settings owns channel-group CRUD and channel labels with current authorization,
selected-resource locks and atomic workspace audit. UI, HTTP and MCP share one
service; composer, Posts filters and Analytics overview reuse scoped groups and
labels. See [CHANNEL_PROFILES.md](CHANNEL_PROFILES.md) for limits, migration, evidence and open work.
The additive migration is unapplied; database/browser verification, broader
profile/filter parity, watermarking and new-label export coverage remain open.
This branch is local only; no push or deployment was authorized.

## Root registration administration branch — 2026-10-20

`/root/registration` and its private HTTP routes use
`server/root/registration-admin.ts`, with Settings-owned invitation revoke and
registration eligibility/mail helpers. Read-only registration configuration,
installation invitation statuses/scopes and unverified self-registration resend/
delete use current Root checks, exact confirmations and transactional audits.
English/French shared table/dialog controls and bounded independent pages are
implemented; no keys/migration/registry edit. MCP definitions and dispatch mapping
are documented, deliberately not registered in this worktree. See
[ROOT_REGISTRATION_ADMIN.md](ROOT_REGISTRATION_ADMIN.md) for behavior and evidence
limits. Actual PostgreSQL, browser, SMTP and MCP transport verification remain open.
