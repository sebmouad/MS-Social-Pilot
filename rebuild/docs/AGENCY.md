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
| MCP definitions and person-only guard | `src/modules/agency/mcp.ts` |
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

- No Agency tool is in the workspace MCP catalog and none is wired to `McpViewer`. Do **not** add
  `agencyToolDefinitions` to `src/server/mcp/server.ts`.
- `executeAgencyTool` accepts only `{ scope: 'person', userId }` and refuses any identity carrying `apiKeyId`,
  `workspaceId`, `workspace`, `permissions` or `isInstanceOwner`, plus every workspace/installation identity.
  Today no authenticator issues a person-wide principal, so the tools are intentionally unreachable.
  A future person-wide MCP credential is a separate architecture decision (Root-visible, audited, with its own
  key ceiling); until then Agency MCP parity is an open release gap, not full support.
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
MCP tools remain absent from workspace/installation catalogs; unsupported
person-wide credentials are not invented. This is an explicit MCP parity gap.

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
existing selected-workspace Team service. Full person-scoped MCP parity, broader
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
  packaging service. The existing person-principal guard remains unchanged.
  **No authenticator currently issues this principal**: real MCP availability is
  still an open gap. Workspace/installation keys cannot export agency data.
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
workspace cap; person-scoped MCP authentication; real database and browser/theme/
phone/failure-path checks, and production-shaped release evidence.

Final local result: 63 tests across 8 files passed with the module-local command
above (including the raw SQL void guard); `npx tsc --noEmit -p .` passed.
The accidentally broadened suite was interrupted after unrelated environment
failures; no server, deployment, push or database migration was performed.
