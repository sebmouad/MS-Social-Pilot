# Architecture contract: MS Social Pilot rebuild

Status: **required target, not a claim of completion**. Established from the user's instructions on 2026-10-15. This is the single product/architecture contract for Codex, Claude, and their subagents. Current implementation and gaps belong in [ARCHITECTURE.md](ARCHITECTURE.md); they must not weaken this target.

## 1. Outcome and scope

Build a fresh, production-ready application in `app/rebuild`. Replace the old interface, routes, icons, text, settings structure, and workflows. Preserving old URLs or appearance is not required. Preserve every useful legacy capability, and add the requested improvements. Use [LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md) as a required inventory, not a reduced definition of scope.

Migrate needed data. Obsolete data may be deleted only after backup, restore verification, and assessment of references and cutover impact. Existing production stays available until the replacement passes all release gates.

## 2. Two independent kinds of module

| Kind | Purpose | Examples |
| --- | --- | --- |
| Product module | What the customer does; independent of providers | Publishing, Inbox, Analytics, Ads, Settings |
| Platform module | How one provider fulfills supported operations | Facebook first; Instagram, YouTube, Pinterest and others in later releases |

Root is the private installation control plane. It is separate from customer modules and workspace administration. A workspace owner/admin is not automatically Root.

Product modules must work with any installed platform exposing the required capability. A platform may support content, messages, analytics, ads, or a subset. An unsupported operation is absent from customer choices; never show a working-looking stub or internal setup warning.

## 3. Strict platform ownership

**Everything specific to Facebook belongs to the Facebook module.** The same rule applies independently to each later platform.

Target physical home: `rebuild/src/platforms/<provider>/**`, including provider-owned server and client slices as needed. Existing `src/server/platforms/facebook*` files are transitional wiring/debt to consolidate; their existence is not permission to scatter new provider logic.

```text
rebuild/src/
  modules/                   product manifests: Publishing, Inbox, Analytics, Ads, Settings
  app/                       thin routes and shared customer screens; private /root routes
  components/ + styles/      shared design system; no provider rules
  server/                    shared authorization, services, jobs, audit and configuration
    platforms/               generic host contracts, installed-module wiring and dispatch
  platforms/
    types.ts                 provider-neutral contracts only
    index.ts                 explicit installed manifests and configuration registration
    facebook/                all Facebook-owned server/client/API/storage mapping behavior
    instagram/               future separate module; unavailable until implemented and enabled
    <provider>/              same contract, independent implementation
```

Concrete boundary examples:

- Valid: a shared composer asks the selected module which media and first-comment operations it supports, then displays that module's safe metadata.
- Invalid: a shared composer checks `provider === 'facebook'` or knows the Graph scope needed for a first comment.
- Valid: a Facebook analytics loader reads its legacy insight tables and emits neutral series with aggregation semantics and audience snapshots.
- Invalid: shared Analytics imports Facebook metric names or has a separate `if Instagram` query/aggregation branch.
- Valid: shared Ads asks the selected account's module for creation options and dispatches a neutral validated operation.
- Invalid: shared Ads contains `OUTCOME_TRAFFIC`, `ads_management`, or a Facebook-specific confirmation format.

A platform module owns:

- Manifest, available operation declarations, branding metadata, resource kinds, Root setting definitions, and safe UI schemas/options/copy.
- OAuth/authentication, discovery, credentials/scopes, token renewal/expiry behavior, connection readiness and provider revocation when supported.
- API endpoints, versions, request/response mapping, transport, pagination, rate-limit interpretation, provider errors and retries.
- Publishing and first comments, supported media/content types, remote scheduling/status mapping, remote deletion and reconciliation.
- Message/comment fetching and actions, provider reply windows and moderation rules.
- Analytics metrics, semantics, units, period rules, availability, storage mapping/normalization, and audience measures.
- Ads account/object discovery, reporting, creation, editing, delivery/status, budgets, creatives, deletion, and every supported operation included in its implementation scope.
- Provider background sync hooks and protocol-required constants with documentation/tests.

Shared UI, product services, contracts, and worker orchestration must not branch on `facebook`, `instagram`, `page`, Graph scopes, provider objective enums, or provider URL shapes. They consume neutral resource types, capability descriptors, normalized data, and safe module metadata.

Allowed provider references outside a module: explicit installed-module registration/imports, migrations/legacy compatibility boundaries, tests/fixtures, and documentation. Such references must not become shared product rules. Shared contracts must not contain provider-named types such as `FacebookCampaignObjective`.

Registering a module makes its settings available to Root. It does not prove functionality. Advertise an operation only after its real implementation, authorization, UI/API/MCP surfaces, and relevant tests exist. General capability flags must not promise unsupported sub-operations.

Adding a provider requires a tested module and a shipped application release. Root configures and enables installed implementations; entering a URL does not implement a new API protocol.

## 4. Shared product core and routes

| Module | Required responsibility |
| --- | --- |
| Publishing | Composer, drafts, media, CSV import with first comment, approvals, queue, calendar, scheduling, publishing, per-destination status, edit/delete where supported |
| Inbox | Conversations/comments, replies, moderation, resolve/reopen, filtering, sync and action history |
| Analytics | One complete analytics experience; every readable available metric retained and exploited, with honest aggregation, details, provenance, coverage, freshness and export |
| Ads | Ad account selection, all supported reporting and management workflows, consistent spend-changing confirmations |
| Settings | Connections, selection, team/roles, account/security, themes, data controls and MCP access; merge duplicate permission pages |
| Root | Every technical option and operational control described in section 8; private to the authorized instance owner |

Use route families `/publishing/*`, `/inbox/*`, `/analytics/*`, `/ads/*`, `/settings/*`, `/root/*` as needed, with no `/app` prefix. Canonical routes are declared consistently by manifests. No old-URL compatibility requirement.

Thin UI/API/MCP entry points call shared application services. Services own tenant checks, state transitions, persistence, auditing, and module dispatch. Do not fork the business rules across interfaces.

## 5. Customer resource and data control

- Connection discovery shows a modal with checkboxes for channels and ad accounts. Add/enable only what the user selects. Support later selection changes.
- Only selected resources from enabled, usable modules appear in normal product screens, filters, reports and MCP results. Connection management may show discovered unselected resources explicitly for selection.
- Connections use a useful table with platform/group sections, relevant status/info, and direct management actions.
- Disconnect requires an explicit retain-or-delete-related-data choice and shows the actual consequences. Do not claim remote revocation if only local credentials were removed.
- A user has view/create/edit/delete control over their own data within their role and provider capabilities. Enforce this on the server.
- Published posts show actual per-platform status. Deletion offers an explicit checkbox to delete remote publications too; unpublished local records can be removed locally. Report partial/uncertain remote results truthfully and preserve reconciliation paths.
- Exports and erasure cover the promised records and media. Disclose coverage accurately; never label a partial export complete. Destructive cleanup requires the backup and verification gates already authorized by the user.

## 6. One design system and consistent UX

Use one new branded design system with selectable themes across all routes, including Root. [../DESIGN.md](../DESIGN.md) owns visual decisions; [../UX-CONTRACT.md](../UX-CONTRACT.md) owns observable behavior.

Navigation, filters, channel/ad-account pickers and route controls belong in the sidebar system, with accessible responsive equivalents. Avoid duplicate settings navigation, duplicate permissions pages, and wrapping pill controls. Use shared buttons, forms, tables, dialogs, feedback and selection patterns.

Customer screens expose only usable/entitled features. Provider credentials, app review/setup status, module enablement instructions and technical errors belong to Root/operator surfaces. Customer errors explain a useful recovery action without leaking internals.

Every workflow needs deliberate loading, empty/no-match, validation, permission, pending, success and failure states. Preserve input and dialog context on recoverable failure. Provide keyboard navigation, visible focus, accessible names and responsive layouts; verify changed flows in light/dark themes and phone/desktop widths.

## 7. Data, analytics and jobs

Workspace is the tenant boundary. Every read/write includes authorized workspace and resource scope. Provider storage is normalized at module boundaries; shared analytics does not query or interpret provider-specific tables directly.

Audience totals sum the latest valid audience measure for every selected eligible channel. Show covered versus selected resources and as-of times. This sum is not deduplicated unique people across networks; never imply otherwise. Missing data is unknown, not zero.

Retain and expose every fetched metric, including additional provider fields/breakdowns. Aggregate according to semantics: flow, stock, ratio, breakdown, period, currency and non-additive reach. Do not silently sum incompatible periods/currencies or duplicate the same series. Include raw source identity in operator/debugging boundaries while presenting understandable customer labels.

Jobs use leases/claims, retries, idempotency/reconciliation, run history and audit. Module hooks own provider sync; the shared worker coordinates. Never run legacy and rebuild publishers against the same queue without a verified single-owner strategy.

## 8. Configuration is a product requirement

Use a typed, versioned registry with validation, defaults, safe secret storage, change history and audited application. Root must manage operational/provider endpoints and credentials/scopes, paths/URLs, module/feature switches, permissions/entitlements, limits, labels/branding/themes, schedules/jobs, retention, logging and MCP settings.

Do not scatter operational literals, provider settings or business rules in application code. A setting marked planned or saved but never consumed is not implemented. Configurable labels/copy need a defined catalog; source literals are not a substitute for the requested Root coverage.

Provider protocol invariants remain isolated and documented in their adapters. Bootstrap dependencies needed before configuration can load (database access, encryption trust material, process startup) need an explicit documented bootstrap contract and secure operator management; do not expose encryption keys in ordinary Root forms or pretend such dependencies disappear.

Changes must validate, audit and apply without source edits when the provider permits it. Provider approval/protocol constraints cannot be bypassed by a Root switch. New executable adapter code is installed through the release process.

## 9. Authentication, authorization and MCP parity

Complete secure authentication and two-factor verification. Enforce membership, feature entitlement, read/write permission, resource scope, module availability and provider grants at the service boundary. Hiding a control is not security. Root access is separate and cannot be acquired through workspace permissions or API keys.

Full authenticated MCP tools and resources cover the same authorized capabilities as the app, including discovery of usable capabilities, confirmations for writes, audit logs and tests. UI/API/MCP must share authorization and domain services. Partial MCP coverage is a release gap, not full support.

## 10. Delivery, consent and proof

The user authorized settings changes, deployment, real data/API tests, and identifiable remote test content with verification and cleanup. Do not repeatedly request permission already granted. Use that authorization within the requested rebuild and test scope; protect credentials and customer data.

Local preview and browser testing must use realistic synthetic example data in a dedicated local database. Seed useful posts, channels, conversations, analytics and ads states so the UI can be assessed as a working product. Keep example-data checks separate from real-provider and production migration/release verification; never present synthetic outcomes as live-platform evidence.

Work in reviewable batches using independent lower-cost agents where useful. Commit working batches to `main`; update evidence and remaining limitations. Each delegated task receives this contract and explicit file ownership.

User update, 2026-10-16: **Always publish completed work to GitHub before the session ends.** Push verified commits to `origin/main` and verify remote state. Do not force-push or misrepresent unfinished work as complete. Report any push blocker and unpushed commits explicitly. GitHub publication is separate from production cutover; it does not bypass the release gates below.

Release requires all of the following, not just a successful build:

1. Legacy capability inventory and all explicit rebuild requirements implemented and reviewed.
2. Functional tests across publishing, inbox, analytics, ads, settings and Root; no inert controls or placeholder flows.
3. Authorization tests for anonymous, member roles, limited resource scope, cross-workspace access, API keys and Root boundaries across UI/API/MCP.
4. Real browser checks across relevant viewports, themes, keyboard and failure states.
5. Real provider/API/MCP tests with outcome verification and cleanup.
6. Production-shaped data migration, counts/relationships/media/permissions verification, and configuration import.
7. A verified restorable backup and a rehearsed service/proxy/data recovery path for the exact release.
8. Safe cutover with one publisher, health checks, representative production workflows and observed results.

Follow [CUTOVER.md](CUTOVER.md). Existing `socialpilot-deploy` currently targets legacy. Rewire and use it for rebuild deployment only after cutover gates pass; do not mistake a legacy deployment for delivering the rebuild.

## 11. Definition of done and change discipline

For each requirement, record authoritative evidence or mark it incomplete. Distinguish code existence, unit checks, browser checks, live remote behavior and production behavior. A manifest, passing test count, old report, intent or file move is not proof of full capability.

Do not mark the project complete until the full target withstands requirement-by-requirement review. Existing shortcuts stay on the implementation-gap ledger; do not copy them into the target contract. Only a direct user architecture decision changes this contract; record what changed and why. New direct user instructions remain authoritative.
