# Agency: cross-workspace administration

Status: **host-integrated with local HTTP/MCP/Chromium evidence; production/release parity remains incomplete.**
Source presence is not capability completion. Production remains legacy.

Agency is a person-level product module. One signed-in person who owns or administers several
workspaces sees them together: which need attention, and which client accounts and invitations exist.
It is not Root, not a workspace feature and not a way to widen one workspace's access.

## What is implemented

| Area | Files |
| --- | --- |
| Vocabulary, ids, types | `src/modules/agency/agency.ts` |
| Manifest (`agency/overview`, `agency/clients`) | `src/modules/agency/manifest.ts` |
| Root settings (9 consumed limits, search bound and attention weights) | `src/modules/agency/config.ts` |
| Membership scope and per-workspace entitlement | `src/modules/agency/server/access.ts` |
| Overview and clients services | `src/modules/agency/server/agency.ts` |
| MCP definitions, person guard and credential dispatcher | `src/modules/agency/{mcp,person-mcp}.ts` |
| Account credential lifecycle, UI and HTTP | `src/modules/settings/person-keys/**` |
| HTTP (session only) | `src/app/api/agency/route.ts` |
| UI | `src/app/agency/{layout,page,AgencyChrome,AgencyFilters,WorkspaceAction}.tsx`, `clients/page.tsx`, `agency.module.css` |
| Tests | `tests/agency-service.test.ts`, `agency-mcp.test.ts`, `agency-route.test.ts` |

### Authority model

- The only way in is a `memberships` row where the signed-in, enabled user is `owner` or `admin`. Root rights,
  workspace names and counts of any other workspace never enter the query.
- For each such workspace the Agency module and the page's feature are re-evaluated at read time through
  `loadEntitlements` with `allowInstallationInspection: false` (plan, Root switches, workspace and member
  switches), evaluated for that person in that workspace; grants are never borrowed across workspaces.
- Each workspace also loads the person's permissions (`loadPermissions`) and requires read on the Agency feature.
  Root rights and installation inspection are never consulted (`allowInstallationInspection: false`).
- **Capability counts follow the owning module, per workspace.** Channels and "cannot publish" need
  `settings/connections`, scheduled and failed posts need `publishing/posts`, open and overdue tasks need
  `tasks/board`, team and client counts need `settings/team`; each needs both the current entitlement and the
  person's read permission in that workspace. Channel and post counts are also withheld when the person's channel
  scope is limited. A withheld count is `null` (shown as a dash with an explanation), is never queried, never counts
  toward attention and sorts last. Totals sum only contributing workspaces, publish `coverage` (covered of total)
  and are `null`, not zero, when nobody contributed. The Clients view lists client accounts and invitations only
  where `settings/team` is readable.
- A workspace without the entitlement is **omitted**. If the person administers workspaces and none is entitled the
  service refuses with `forbidden` instead of presenting an empty list. A failure to evaluate one workspace drops
  only that workspace (fail closed).
- A suspended workspace, or one whose data erasure is in progress, is listed by name and role with its data
  withheld (`metrics: null`, state `suspended` / `deleting`). Counts and clients are only read for `available`
  workspaces, using that exact id list.
- Client invitations are read through `listTeamInvitations` as the person, which applies the Team feature's own
  authority per workspace. A denied or failing invitation read never hides client accounts.
- Everything is read-only. Invitation/team changes stay in the Settings team services (the UI links to them).
- Totals are sums of counts in separate workspaces, never de-duplicated people or posts, and are computed over all
  managed workspaces regardless of table filters.

### Workspace-scoped MCP keys cannot read other workspaces

- No Agency tool is in the workspace MCP catalog or wired to `McpViewer`. The host chooses a disjoint
  person dispatcher before workspace/installation handling; never add Agency to a workspace tool group.
- `executeAgencyTool` accepts only `{ scope: 'person', userId }` and refuses any identity carrying `apiKeyId`,
  `personKeyId`, `readFeature`, `workspaceId`, `workspace`, `permissions` or `isInstanceOwner`, plus every
  workspace/installation identity. Credential identities must pass through `person-mcp.ts`, which revalidates
  the stored person key and permits only the overview before calling the internal person service.
  The overview now has credential authentication; the Clients tool remains unavailable to credentials.
- The HTTP route refuses `Authorization` and `X-API-Key` headers and relies on the browser session cookie only.
  Pages and the route use `requireViewer({ channelScoped: true })` so the selected workspace's role does not decide
  person-wide access; the service checks every membership.

### Search, limits and Root settings

- Search runs **in SQL before the workspace cap**, with a parameter-bound pattern in which `%`, `_` and `!` are
  escaped (`ILIKE ... ESCAPE '!'`). Overview search matches workspace names. Clients search also matches workspaces
  that hold an enabled client account whose name or email matches, and inside a workspace whose own name did not
  match only the matching clients are listed. Pending invitations are **not searchable** (their authority is the Team
  service); they are listed for the workspaces the search selected.
- `truncated` is true when more than `agency.workspaceLimit` workspaces match; the notice says so, and a search
  narrows the result honestly because the database applies it first. The needs-attention filter depends on counts and
  still applies only to the capped window; the notice says so.
- Totals describe the matching workspaces when a search is active (`filtered: true`, labelled "matching") and ignore
  the attention filter and the sort, which only affect the table.
- Root owns every operational value: `agency.workspaceLimit`, `failureWindowDays`, `clientListLimit`,
  `searchMaxLength` (also the form `maxLength`, via `agencySearchLimit()`), `accessConcurrency` (workspaces checked
  in parallel, formerly a source constant) and the four `attentionWeight*` sort weights (formerly source constants,
  defaults 1000/100/10/1). All are validated on every read; an invalid value makes Agency unavailable.

### UX

Two pages under the shared design: `/agency` (summary tiles, sortable table, row actions) and
`/agency/clients` (per-workspace client accounts and pending/expired invitations). There is **no in-page view
switcher or third menu**: `app/agency/layout.tsx` wraps pages in the shared `PageFrame` (module `agency`,
`scopedAccess`), so the manifest pages (Workspaces, Clients) appear in the module's contextual sidebar. Filters are in the contextual
sidebar/drawer. Row actions (Open, Fix connections, Review posts, Overdue tasks, Manage team) switch the session to
that workspace through `/api/workspaces/select` and navigate there; failures stay inline with the button and keep
the page. Loading is server-rendered; empty, no-match, forbidden/load-error and truncated states are distinct.

## Host integration (implemented in batch 77)

The Agency manifest is registered in the product catalog. Registry 70 registers
nine active configuration values and manifest-generated module/feature switches.
Permissions allow owner/admin reads and no Agency writes; other roles cannot
navigate to Agency. Legacy modular plans explicitly grant `agency/overview` and
`agency/clients` through grouped Root plan controls. Stored workspace/member
module and feature exclusions are enforced. Agency owns no new tables.

API reads require a browser session. Anonymous redirects become safe 401/403
responses; presented bearer/API-key headers are refused. Installation availability
is checked before data reads, including suspended rows. Suspended metadata also
requires current workspace/member switches and plan access; metrics stay withheld.
Agency MCP tools remain absent from workspace/installation catalogs. The separate person credential
dispatcher exposes only the overview, as documented below; this is not complete Agency MCP parity.

## Evidence and limits

The guarded actual local probe passed HTTP, PostgreSQL, MCP exclusion, hydrated
Chromium page contents and workspace selection. It covers owner/admin tenants,
editor-only/foreign exclusions, current Agency switches, suspended/erasing state
withholding, strict filters and Root bounds, client association search refusal,
header credentials, anonymous authentication and selection request refusals.
Fixtures and synthetic audit rows were removed; exact captured Root settings
were restored and verified. Initial runs exposed real API/policy defects, fixed
with regression tests. Page verification now uses Chromium because Next streams
loading and content boundaries separately; raw HTML regex checks were invalid.
The pinned Playwright development dependency and installed Chromium are required.

Chrome separately verified the two-sidebar desktop layout, 390px phone width with
358px table-local scrolling, drawer filters, no-match/reset, Escape focus return,
and an offline switch error followed by successful online retry. Four temporary
theme renderings changed actual computed colors without page overflow and were
restored to Grove; this is not full all-theme accessibility certification.
Final isolated suite/build/typecheck evidence is recorded in AGENT_HANDOFF.md.

Search matches workspace names only, before the Root-bound scan cap. Results and
totals cover that window; there is no complete keyset-pagination traversal.
Entitlement/permission queries remain per workspace and require scale measurement.
Unavailable metric groups show withheld coverage rather than zero. Read authority
is refreshed at entry, not serialized with concurrent access revocations.
Read access is not separately audited. Agency is read-only; team changes use the
existing selected-workspace Team service. Clients credential MCP parity, broader
Agency writes and production-shaped runtime/release evidence remain open.

## Wave 3: downloadable cross-workspace overview (2026-10-20)

Chosen capability: an internal agency overview export, in CSV and JSON, available
from `/agency` with the currently applied workspace-name search, sort, direction
and attention filter. This packages useful existing cross-client oversight into a
portable handoff without requiring a new permission model or public sharing token.

Legacy comparison: `src/app/(app)/agency/page.tsx` and `src/lib/agency-access.ts`
provide owned-client counts and a cross-client staff role matrix with grant/remove
actions. The separate `src/lib/agency.ts` health reader includes followers,
engagement and priced AI spend. `src/app/share/[token]/page.tsx` offers review,
calendar and results tabs. The rebuild's authorized Agency overview and client
lists already cover operational oversight, but lacked a downloadable overview.
This batch adds that capability; it does not claim the legacy role matrix,
performance metrics or portal results are complete.

Implementation:

- `src/modules/agency/server/export.ts` owns packaging and calls `agencyOverview`
  afresh for every request. It accepts no workspace ids, supplied rows or saved
  artifact ids. Memberships, current entitlements/permissions, per-module counts,
  channel-scope withholding, suspension and erasure behavior stay in the existing
  shared service. No new SQL, writes, migration or provider branch is introduced.
- `GET /api/agency?format=csv|json&locale=en|fr` returns a versioned JSON receipt
  containing filename, content type, UTF-8 byte count and file contents. Existing
  overview query parameters apply. Duplicate/unknown parameters and export options
  on the Clients view are refused. All responses are `no-store`; browser sessions
  are required and presented bearer/API-key credentials are refused.
- `get_agency_overview` accepts optional `format` and `locale` and calls the same
  packaging service. The internal person guard continues to refuse credential identities.
  The person credential dispatcher now authenticates overview-only keys and uses this same packaging
  service. Workspace/installation keys cannot export agency data. Live transport proof remains open.
- `ui/AgencyExport.tsx` uses shared Buttons with English/French copy selected from
  the request's primary Accept-Language. Both formats preserve filters, prevent
  duplicate submissions, validate receipt type/version/filename/exact bytes, and
  show focused preparation/failure feedback. A keyed filter change or unmount
  aborts the old request. Prepared means a download was requested, not proof of a
  file saved on disk. This read operation needs no destructive confirmation.
- CSV is a rectangular long-form table (record type, workspace id/name, measure,
  value, denominator), with context, matching totals, coverage and workspace rows.
  It includes UTC generation time, failure window, filters, scan limit/truncation
  and exported workspace count even for empty results. Context explains that
  totals ignore the attention filter. Fields are quoted, spreadsheet formulas
  neutralized, and a UTF-8 BOM supports accented spreadsheet copy. Unknown values
  read “Not available” / “Non disponible”; measured zero stays zero. JSON retains
  nulls, stable field names and the same context/coverage.

Bounds: the existing Root `agency.workspaceLimit`, search bound, failure window
and authority concurrency apply. No new Root keys; no registry changes. Exports
cover the same capped scan as the overview, not an exhaustive all-client dataset.
They contain workspace/team counts, not client emails, report analytics or public
portal links. They are private internal exports, not client-safe report packages.

Verification from `rebuild/`:

```sh
npx vitest run --config src/modules/agency/vitest.config.ts
npx tsc --noEmit -p .
```

The module-local Vitest config includes existing agency service/route/MCP/UI/host
tests, `tests/raw-sql-void-guard.test.ts`, and owned export service/HTTP/MCP/download
component tests. New tests use synthetic mocked data; they do not establish real
PostgreSQL, live credential MCP, browser download, provider or production behavior.
An initial config merge unintentionally included the full suite: unrelated tests
hit missing database configuration and denied loopback socket creation. The config
was corrected to replace the include list; no full-suite pass is claimed.

Remaining: cross-client staff role matrix and mutations through the Team service;
analytics/AI-spend overview through neutral owning-module contracts; public portal
results; branded client report bundles and delivery; full pagination beyond the
workspace cap; Clients credential MCP access; real database and browser/theme/
phone/failure-path checks, and production-shaped release evidence.

Final local result: 63 tests across 8 files passed with the module-local command
above (including the raw SQL void guard); `npx tsc --noEmit -p .` passed.
The accidentally broadened suite was interrupted after unrelated environment
failures; no server, deployment, push or database migration was performed.


## Person-scoped overview credentials (2026-10-20, codex/agency-mcp)

The user authorized a separate personal credential for the cross-workspace overview.
It has a fixed `agency/overview` read ceiling. Workspace credentials and installation
sessions retain their existing catalogs. No provider rule or registry edit is added.

### Lifecycle and account access

`settings/person-keys/service.ts` owns list, issuance, revocation, authentication
and stored-key revalidation. `/settings/account` renders its shared-design Manager;
if workspace account settings redirect (including after losing every membership),
a session-checked account-only fallback still exposes credential revocation. That
fallback grants no workspace or Root authority. The management HTTP endpoint is
`/api/settings/account/person-keys` (GET, POST, DELETE), accepts browser sessions
only, refuses any Authorization/X-API-Key headers and URL scope parameters, and
requires same-origin JSON for mutations. It takes the account id only from the
verified, non-pending, unexpired browser session and rechecks the enabled user.

Issuance requires an enabled account, enabled MCP/person-key controls and at least
one currently available workspace with Agency overview authority, checked through
the existing per-workspace Agency policy. It records no workspace list or saved
permission snapshot. Revocation and active-key listing do not require continued
Agency access or enabled issuance switches. Thus losing membership or turning off
MCP does not prevent personal key revocation. The active-key directory is bounded;
if Root reduces the ceiling below the existing count it discloses truncation and
revoking listed keys makes subsequent entries accessible.

Exact confirmations are stable protocol strings in both locales:

- `CREATE AGENCY KEY <trimmed name> <days> DAYS` binds both editable choices.
- `REVOKE AGENCY KEY <key id>` binds the specific credential; the dialog also shows
  its name and safe prefix.

The UI uses `components/useConfirm.tsx`, locks the form while confirmation is open,
does not submit on cancel or mismatched text, and preserves confirmation/input on
failure for retry. English/French copy covers loading, empty, unavailable, pending,
retry, success and failure states. A new secret is shown once in component memory;
creation stays disabled until it is hidden. It is never persisted in browser storage.

### Storage and authority

An additive raw-SQL table, `person_mcp_keys`, is intentionally separate from
`mcp_api_keys`; no Prisma client regeneration is needed. Migration:
`prisma/migrations/20261030130000_rebuild_person_mcp_keys/migration.sql`, ordered
after the existing watermark migration. It is **unapplied**. The table has a
user foreign key with deletion cascade, unique SHA-256 token hash, safe prefix,
expiry/revocation timestamps and a database CHECK fixing `readFeature` to
`agency/overview`. There are no workspace ids, resource ceilings or write grants.
The secret is `mcp_person_` plus 32 random bytes encoded as base64url and is
returned only by issuance. Lists/audits exclude hashes and secrets.

Issuance/revocation lock the enabled person and serialize their key changes with a
person-namespaced transaction advisory lock (`::text`). Active-count enforcement,
the mutation and a checked `root_activities` audit insert share the transaction;
failed inserts/audits abort the operation. Account disabling is checked again at
transaction entry. Reads are current-at-entry, not serialized with concurrent
workspace membership/entitlement changes; no stronger concurrent-revocation
linearization is claimed.

Send the key as `Authorization: Bearer mcp_person_…` to `POST /api/mcp` with no
scope query parameter. An explicit workspace or installation scope refuses it.
The workspace bearer parser explicitly excludes this prefix, including for other
workspace-key APIs. Presented invalid/revoked person keys never fall back to
workspace authentication or cookies. Each key uses the existing
`mcp.keys.requestsPerMinute` budget under its own person-key rate identity.

A `PersonMcpIdentity` contains user id, person-key id and the fixed overview ceiling;
it carries no workspace, permissions or installation-owner flag. The MCP host
validates the common JSON-RPC envelope and selects `agency/person-mcp.ts` before
workspace tool initialization/dispatch. That dispatcher rechecks the enabled
account, stored unrevoked/unexpired key, global switches and stored ceiling for
every invocation. Its only tool is `get_agency_overview` (including existing CSV/
JSON packaging), and its only resource is `msp://agency/overview`. All workspace,
Root, Clients, key-management, unknown tools and other resources are refused.

Every overview/export calls the existing Agency service afresh. Its membership
query requires the current enabled person's owner/admin role; every workspace
gets its own current Agency/module/plan/permission checks without installation
inspection. Revoked/demoted memberships and denied/failed access evaluations
cannot borrow another workspace's grants. Channel-limited metrics stay null,
suspended/purging workspace data stays withheld, and unknown values remain
“Not available” / “Non disponible”. Newly eligible workspaces are included
without reissuing the key, as explicitly disclosed at issuance. No write is added.

### Root controls and verification

Settings owns these auto-aggregated declarations in `person-keys/config.ts`:
`mcp.personKeys.enabled`, `mcp.personKeys.maxActivePerPerson`,
`mcp.personKeys.maxLifetimeDays`, `mcp.personKeys.nameMaxLength`.
The Settings manifest declares their prefix; no `registry.ts` change or schema
version bump was made, per the worktree instruction. The host owner must account
for the new keys in the next centrally managed configuration version. Existing
`mcp.keys.transactionTimeoutMs`, `transactionMaxWaitMs`, `requestsPerMinute` and
Agency read limits retain their live consumers.

Owned `person-*.test.ts` files exercise service, host, transport, per-workspace
access, HTTP/session/CSRF, Root config ownership and real shared confirmation
components with synthetic mocked storage/jsdom. Targeted checks from `rebuild/`:

```sh
npx vitest run --config src/modules/agency/vitest.config.ts
npx vitest run tests/mcp-route-auth.test.ts tests/mcp-installation-context.test.ts tests/mcp-security.test.ts tests/mcp-key-service80.test.ts tests/mcp-resource-scope80.test.ts tests/mcp-resource-dispatch80.test.ts tests/account-settings.test.ts tests/raw-sql-void-guard.test.ts
npx tsc --noEmit -p .
```

These are local code/test checks only. The migration needs the documented backup/
scratch-restore gates before application. Actual PostgreSQL constraints, rollback,
locking/concurrency, HTTP/MCP with real credentials, browser themes/viewports and
live release evidence remain open. No servers, installation, client generation,
push, deployment or production change is authorized for this batch. Clients
credential access and broader Agency parity remain unimplemented.


Final local test evidence for this batch: 147 tests/16 files passed in the Agency
suite, and 211 tests/8 files passed in the related MCP/account suite (the SQL
guard is counted in each run). Independent read-only source review found no
critical or important security defect. Exact confirmation strings deliberately
remain stable protocol strings in both UI locales. No full repository suite,
build, actual PostgreSQL, browser or live MCP verification is claimed.

TypeScript (`npx tsc --noEmit -p .`) and `git diff --check` also passed.
Commit remains blocked because Git cannot create the linked worktree's
`index.lock` outside this sandbox (`Operation not permitted`). No new commit
was created; verified source stays uncommitted on `codex/agency-mcp`.
