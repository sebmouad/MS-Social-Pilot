# Calendar extras lane handoff

> **Installed 2026-10-22 (source).** Every item under "Required edits outside the owned directory" is done: config/MCP registered, pages, API and ICS routes, sidebar links, board marks, queue season hook (`server/queue-seasons.ts`), Analytics chart notes (`server/chart-notes.ts`), tests moved to `rebuild/tests/calendar-extras*.test.ts`, MCP_PARITY rows, and the `calendarHolidays`/`calendarTrends` jobs (`server/refresh.ts`). The text below is the original lane handoff; where it says "pending/not installed" the installation record in ARCHITECTURE.md supersedes it.

This directory is authored implementation, **not an installed or released feature**.
Only `rebuild/src/modules/calendar-extras/**` was editable in this lane. No app
routes, installed hosts, shared charts, queue allocator, docs outside this directory,
schema version, database, server, production, Git commit or remote was changed.
The contract remains binding. No Facebook Groups capability is added; a channel
group here means the existing workspace organization in `page_groups`.

## Source and shared-service ownership

- `manifest.ts`: canonical screen routes inheriting `publishing/calendar` or
  `analytics/overview`. Do not append these as duplicate feature IDs in `PAGES`.
- `config.ts`, `copy.ts`: two validated Root entries: `calendarExtras.policy` and
  `calendarExtras.customerCopy`. Policy contains runtime limits, choices, feed
  window/statuses/path, request bounds and transaction bounds. Bilingual customer
  copy covers forms, errors, empty states, permissions and confirmations.
- `contracts.ts`: neutral actor, scope and record contracts.
- `server/access.ts`: current account/membership/workspace/plan/feature checks,
  independent credential ceilings, selected usable connections, transaction lock,
  exact-scope validation and content-free atomic audit.
- `server/settings.ts`, `validation.ts`: runtime readers and shared validation.
- `server/service.ts`: options, lists, create/update/delete and complete seasonal
  rule loading. UI, REST and MCP call these functions without separate rules.
- `server/subscriptions.ts`, `ics.ts`: personal revocable feed tokens, legacy
  SHA-256 compatibility, current creator authorization, scoped whole-post reads,
  UTC events and RFC 5545 escaping/octet folding. Raw secrets appear only in the
  create receipt. No token/hash/content is written to the activity record.
- `server/trends.ts`: country inheritance from authorized selected channels,
  existing workspace keywords, stored holidays, per-country/year coverage and
  freshness-bounded stored topics. Incomplete input over policy limits is refused.
- `server/seasons.ts`: pure legacy-compatible pause/shift/fewer/more slot
  composition; yearly key-date matching.
- `server/http.ts`, `mcp.ts`, `ui/actions.ts`: thin transport entry points.
- `ui/CalendarExtrasScreen.tsx`, `CalendarWorkspace.tsx`, `TrendPanels.tsx`,
  `NotesTimeSeriesChart.tsx`, `calendar-extras.module.css`: five prepared screens,
  shared authoring dialogs and annotated chart integration component.
- `tests/calendar-extras.test.ts`, `tests/calendar-extras-ui.test.ts`,
  `vitest.config.ts`, `.gitignore`: scoped tests/configuration/cache exclusion.

No migration/import is necessary for the retained records: the service uses
existing `key_dates`, `seasonal_modes`, `calendar_feeds`, `chart_notes`,
`public_holidays`, `holiday_years`, `trending_topics`, `page_groups`,
`page_group_targets`, `workspaces.audienceCountries`, `targets.audienceCountries`
and `workspaces.trendKeywords`. This is direct scoped access to the existing
legacy storage boundary, not an assertion that fresh PostgreSQL fixtures or
production application have been verified. Do not copy customer rows to local
preview fixtures. No new table is introduced.

## Required edits outside the owned directory

1. In `src/modules/installed-config.ts`, import `CALENDAR_EXTRAS_CONFIG` from
   `./calendar-extras/config` and spread it into `INSTALLED_MODULE_CONFIG`.
   Without this, runtime readers correctly refuse unknown keys, and
   `tests/config-validation.test.ts` flags exactly these two missing entries.
   Group `calendarExtras.` under Publishing in `publishing/manifest.ts` (including
   the Root key ownership metadata used by your current host). Integrator alone
   increments `CONFIG_SCHEMA_VERSION` once for the combined release.
2. In `src/modules/installed-mcp.ts`, import and spread `CALENDAR_EXTRAS_MCP`.
   Fifteen tools cover options/list/change for dates, seasons, feeds, notes,
   trends. All writes are service-locked and audited. All tools are classified
   workspace tools: the MCP host must continue refusing resource-restricted keys
   for this whole-workspace directory/subscription surface. Direct service actors
   still independently narrow resource ceilings. Pass `apiKeyId` for audit.
3. Add thin app pages under the existing authenticated route group, re-exporting
   the named screen as default from `@/modules/calendar-extras/ui/CalendarExtrasScreen`:

   | Route | Screen export | Inherited feature |
   | --- | --- | --- |
   | `/publishing/calendar/dates` | `KeyDatesScreen` | `publishing/calendar` |
   | `/publishing/calendar/seasons` | `SeasonsScreen` | `publishing/calendar` |
   | `/publishing/calendar/feeds` | `CalendarFeedsScreen` | `publishing/calendar` |
   | `/publishing/calendar/trends` | `TrendsScreen` | `publishing/calendar` |
   | `/analytics/notes` | `ChartNotesScreen` | `analytics/overview` |

   Use existing shell/loading/error boundaries. Add contextual sidebar links from
   the main Publishing calendar and Analytics screen. The prepared screens use
   `SidebarDock`; do not introduce another menu or a separate product module rail.
4. Mount thin API routes using `calendarCollectionHttp(area)` and
   `calendarItemHttp(area)` from `@/modules/calendar-extras/server/http`:

   | Collection | Area | Collection methods | Item methods |
   | --- | --- | --- | --- |
   | `/api/key-dates` | `dates` | GET, POST | PATCH, DELETE |
   | `/api/seasons` | `seasons` | GET, POST | PATCH, DELETE |
   | `/api/calendar-feeds` | `feeds` | GET, POST | DELETE |
   | `/api/chart-notes` | `notes` | GET, POST | PATCH, DELETE |
   | `/api/calendar/trends` | `trends` | GET, POST | none |

   Collection GET accepts inclusive `from`, `to`, optional `targetId`, `offset`,
   `showAll`; `?view=options` returns the policy, copy and authorized choices.
   Collection POST accepts `{operation, id?, data?, confirmation}`. Item PATCH
   accepts `{data, confirmation}`; DELETE accepts `{confirmation}`. Item handlers
   inject the path ID and reject a body-supplied ID/operation.

   Example collection route:

   ```ts
   import { calendarCollectionHttp } from '@/modules/calendar-extras/server/http';
   const handler = calendarCollectionHttp('dates');
   export { handler as GET, handler as POST };
   ```

   Re-export `calendarFeedHttp as GET` at `/api/calendar-feed/[token]/route.ts`.
   This is the intentional read-only bearer subscription surface; it rechecks
   the feed creator, current plan/grants, suspension and resource selection.
   Apply the existing public-route throttling/log redaction at the host boundary;
   never include the token URL in access logs or analytics.
5. Queue owner calls `seasonalRules(actor, from, to, targetId)` and
   `adjustDaySlots(slots, seasons, selectedTargetIds, workspaceDay)` when allocating
   **new** queue slots. Preserve existing worker qualification/leases/approval and
   audit. Existing scheduled posts must not be moved. This lane cannot edit the
   allocator, so the Seasons screen explicitly discloses unavailable automatic seasonal scheduling.
   Update that Root-editable notice once the hook is mounted and verified.
   Calendar board owner also loads authorized dates for the visible range, follows
   pages, and applies `keyDateOn(keyDate, workspaceDay)` to show each milestone in
   the existing calendar/phone agenda. Management alone does not mount board marks.
6. Analytics owner loads scoped notes via `listCalendarEntries(actor, 'notes',
   appliedFilters)`, following pages (or refusing a declared complete-result limit),
   and renders `NotesTimeSeriesChart` instead of `TimeSeriesChart` with `notes`,
   `noteColors: policy.colors` and the selected copy. Marks use the chart timezone;
   the accessible data table and dated disclosure contain full labels. Notes
   management uses the same service. Mounting on existing Analytics/report charts
   is pending and must not be claimed done from this component alone.
7. Add this test glob to root `vitest.config.ts` or move these two tests to root
   `tests/` under an integrator-owned change. The scoped config runs them now;
   the unchanged default suite deliberately does not discover module-local tests.
8. Update `docs/MCP_PARITY.md`, `ARCHITECTURE.md`, `UX-CONTRACT.md`, `GOAL.md`,
   `DELIVERY_PLAN.md`, `AGENT_HANDOFF.md` and the relevant legacy sweep rows after
   installing and verifying these surfaces. These documents are outside lane
   ownership. Do not mark an unmounted route/queue/chart integration as done.
   Existing data-control coverage for retained tables also needs integration-owner
   review; no new table/catalog row was added here.

## Confirmation and parity mapping for MCP_PARITY.md

All confirmation strings are case-sensitive service protocol identities, equally
required by UI, REST and MCP. Translated labels surround the exact phrase.
Create: `CREATE CALENDAR <AREA> <workspaceId>`; update/delete:
`UPDATE|DELETE CALENDAR <AREA> <entryId>`. `<AREA>` is DATES, SEASONS, FEEDS,
NOTES or TRENDS. Trends uses the workspace ID for update and supports keywords
only. Feeds supports create and revoke/delete, never token recovery/update.

| Capability | UI | REST | MCP | Shared service / audit |
| --- | --- | --- | --- | --- |
| Key dates CRUD, yearly and channels | Calendar dates | `/api/key-dates[/id]` | `get_calendar_dates_options`, `list_calendar_dates`, `change_calendar_dates` | calendarOptions / listCalendarEntries / changeCalendarEntry; `calendarExtras.write` |
| Seasonal rules CRUD | Calendar seasons | `/api/seasons[/id]` | same prefix with `seasons` | same; scoped complete queue hook awaiting mount |
| Personal token feeds create/list/revoke | Calendar feeds | `/api/calendar-feeds[/id]`, `/api/calendar-feed/[token]` | same prefix with `feeds` | same; renderCalendarFeed is token read only |
| Chart notes CRUD | Analytics notes / prepared annotated chart | `/api/chart-notes[/id]` | same prefix with `notes` | same; existing chart mount awaiting owner |
| Holiday coverage, recent searches, keyword editing | Calendar trends | `/api/calendar/trends` | same prefix with `trends` | same + readTrends; stored data only |

## Remaining behavior and evidence gaps

- Holiday/trend refresh jobs are not ported here. Existing cached rows are read;
  stale topics disappear by the configured freshness window. The worker owner must
  port legacy country refresh with Root-managed URLs, refresh intervals, batches,
  timeout/body bounds and safe outbound fetch before claiming ongoing live data.
- Browser screenshots/theme/phone/keyboard tests were not run because this lane
  explicitly forbids starting servers. DOM/render tests establish narrower evidence.
- No PostgreSQL execution/rollback test, token HTTP subscription app, real calendar
  client or production/provider verification was performed. The SQL uses retained
  legacy table names; integration must exercise it against a synthetic local DB.
- Legacy token addresses keep the same token hash format but require mounting
  `/api/calendar-feed/[token]` on the existing public origin. A new feed needs a
  valid Root `app.publicOrigin`; no guessed request host is used.
- Group feeds created from an unrestricted browser session retain legacy dynamic
  group/current-member scope. Restricted actors and key-created subscriptions
  snapshot their authorized channels and intersect current group membership on
  every read; later additions cannot expand a durable credential's scope. Existing
  legacy group feeds with empty pageIds retain dynamic group/current-member scope. No Group publishing/discovery is added.
- Feed event overflow is refused rather than silently truncating. A calendar app
  may poll at its own interval; revocation cannot retract already downloaded data.

## Design application by prepared screen

The existing product DESIGN/UX contract takes precedence over a new style draw.
All screens retain the installed palette/type/module identity and shared shell.
No made-up metrics, thumbnails, charts or trends are inserted.

| Prepared screen | Visible design and skill rules applied |
| --- | --- |
| Key dates | Content-first dated agenda with yearly and channel context; one Add action. Taste: real objects/density/honest emptiness. Web guidelines: semantic list/time, labeled controls, focus and preserved input. Composition: reusable shell plus explicit editor fields. React: server-loaded scoped props, no client data waterfall. |
| Seasons | Dated rule agenda, names and end dates with a clear integration notice. Same four rules; native select options come from runtime policy, numeric limits match service policy. |
| Holidays/trends | Separate balanced holiday/topic panels, country and fetched dates, visible unknown coverage and safe external links. Same four skills; independent stored reads use Promise.all, keyword editing composes the shared confirmation. |
| Calendar feeds | Personal subscription agenda, direct revoke confirmation, a one-time selectable private-address panel. Same four skills; no raw token in list or audit, shared Dialog and pending guard. |
| Chart notes | Dated note agenda/editor; prepared chart has dashed dated marks, full accessible labels/table and a notes disclosure. Same four skills; one service result supplies marks and text, theme chart colors avoid raw color values. |

Responsive grids use minmax(0,1fr), channel choices have 44px hit areas and bounded
scrolling, panels inherit theme tokens, errors use live announcements, recovery
preserves form values. Unconfirmed creations are held until the user reviews the
list instead of inviting blind repeat. Actual browser design clearance is pending.

## Verification collected in this worktree (2026-10-22)

Commands run from `rebuild/`:

- `npx tsc --noEmit -p .`: PASS, exit 0, zero errors.
- `npx vitest run --config src/modules/calendar-extras/vitest.config.ts src/modules/calendar-extras/tests/calendar-extras.test.ts src/modules/calendar-extras/tests/calendar-extras-ui.test.ts`:
  PASS, exit 0; 2 files, **51 tests** (46 service/protocol and 5 DOM/render/chart).
  Browser-native dialog methods are shimmed in jsdom; this does not prove native
  focus trapping or visual behavior. Database/entitlements/config are mocked in
  service tests; SQL shape checks are not actual PostgreSQL execution or rollback.
- `npx vitest run tests/parity-guard.test.ts tests/config-validation.test.ts`:
  parity **22/22 PASS**; config **6/7 PASS, 1 FAIL**. The failure identifies exactly
  `calendarExtras.policy` and `calendarExtras.customerCopy` as unregistered runtime
  reads. Required registration is outside this lane's paths. The first run also
  encountered EPERM while writing Vitest's shared node_modules cache; the scoped
  config now disables its result cache and uses a module-owned Vite directory.
- Required full command `npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts"`
  was run. A final rerun with `--no-cache` avoided the shared cache permission
  error: **640 files passed, 2 failed, 49 skipped; 9,858 tests passed, 6 failed,
  2,083 skipped**. Five failures are `tests/facebook-native-http.test.ts` loopback
  socket binds (`listen EPERM ::1`); the sixth is the module registration failure
  above. **The whole suite is not green.** Default discovery does not include the
  module-local tests, whose separate 51-test result is given above.
- Per-file `git diff --no-index --check /dev/null <new-file>`: PASS, no whitespace
  errors. `git status --short` shows only this new module beyond the pre-existing
  patch files and node_modules symlinks. No tracked files outside ownership changed.

No server, app build, live HTTP/MCP client, PostgreSQL, provider, calendar client,
production, deployment, commit or push verification is claimed. The work is left
in the working tree for the integrator. Legacy sweep rows and parity mappings
must remain pending until installation, queue/calendar/chart mounting and relevant
runtime evidence are complete. CONFIG_SCHEMA_VERSION was not edited.
