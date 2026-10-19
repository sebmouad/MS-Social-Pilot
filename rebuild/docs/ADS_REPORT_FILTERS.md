# Ads report filters and Root policy — batches 56–58

## Current behavior

Ads owns pure filter interpretation in `src/modules/ads/report-filters.ts`.
The database read boundary remains `modules/ads/server/queries.ts`; its re-export keeps
existing internal consumers on the same parser. No provider rule was added.

Both Ad accounts and Campaigns validate the selected account, date preset and
custom calendar dates before requesting a report. Unavailable accounts, invalid
or reversed dates, missing custom endpoints and repeated parameter values return
field-specific correction state. They never become an all-account/default-period
report. Validation leaves the account directory available for the sidebar picker,
but does not query insights or construct campaign-management controls.

The sidebar retains requested values, including an explicitly unavailable
account. Malformed dates use an editable text field so native date-input
normalization cannot erase the value needing correction. Fields have associated
errors; the route focuses a safe alert. Error text stays outside the input label
so its accessible name remains concise. Reset and valid resubmission recover the
normal route. No message exposes provider setup or Root configuration.

Date fields are disabled for presets and become editable when Custom dates is
selected. Their values are serialized only for custom ranges. Valid ranges use
inclusive UTC calendar endpoints, represented internally with an exclusive end.
The picker and parser share one Ads-owned preset catalog. Sidebar inputs and
buttons use the shared themed form primitives, with 44px input targets.

Account summary counts now use the same filtered account set as visible
cards. The picker still lists all currently accessible selected accounts so the
user can change the selection. The data boundary independently intersects a
requested ID with workspace/resource/provider-authorized accounts; a direct
unavailable selection cannot override that mandatory predicate.

## Evidence and remaining scope

Tests first reproduced the silent default/all-account fallback, stale summary
counts and editable-but-ignored preset dates. After implementation, 19 focused
tests passed, including an additional empty-account recovery case. The final
guarded full suite passed 1,499 tests in 224 files. TypeScript, isolated production
build and whitespace checks passed. PREVIEW_QA.md records actual browser/MCP
checks separately from these tests.

No database migration, configuration version change, provider request or
production deployment was introduced. The existing MCP report already refuses
unavailable account IDs; its authenticated response was checked again.
This is not a new Ads API or complete reporting/MCP parity.

The Root preset/default and UI/MCP date-policy gaps identified in batch 56 are
addressed below. Complete report pagination, comparisons, freshness/status
presentation, exports and broader Ads workflows remain open.

## Root-managed reporting policy — batch 57

Registry **52** installs `ads.reportingFilters` from the Ads-owned `config.ts`.
The public module manifest owns its `ads.` prefix; executable validation schemas
stay out of client manifests. Root groups the control under Product modules →
Ads → Ads. Existing Root UI, HTTP and installation MCP writes use the registry
schema, persistence service and value-free atomic `config.changed` audit.

The setting is one strict JSON object so coupled changes validate atomically:

```json
{
  "presets": [
    { "id": "7d", "days": 7, "label": "Last 7 days" },
    { "id": "30d", "days": 30, "label": "Last 30 days" },
    { "id": "90d", "days": 90, "label": "Last 90 days" }
  ],
  "defaultPreset": "30d",
  "maxRangeDays": 366,
  "maxFilterCharacters": 200
}
```

Root may replace preset IDs, durations, labels and the default without editing
source. The schema requires 1–12 unique presets, a listed default, safe IDs of
at most 32 characters, labels of at most 80 characters without control codes,
and every duration within the configured maximum. The maximum is an integer
1–3650 days; the filter-string ceiling is 10–2048 UTF-16 code units and must fit
every preset ID. Ten accommodates ISO calendar dates. These outer integrity
caps and the reserved `custom` token are code-owned format constraints, not
separately configurable operational defaults.

The authenticated server loads and validates one policy per report request.
Only serializable public filter metadata enters the client form; no registry
schema, secret or provider setting is passed to it. Unreadable/invalid policy
fails closed with safe recovery text. Old preset URLs require correction when
Root removes their preset; they never become the new default silently. Empty
`account=` now also requires correction; a missing account filter or explicit
UI `all` is the deliberate all-account selection.

Both report pages and `get_ads_performance` use the same pure Ads parser for
date presets, inclusive UTC custom days, character ceilings and account scope.
The data query independently intersects workspace/resource/provider access.
This removes the MCP report's former Analytics-policy dependency and local-time
date interpretation. Custom endpoints are represented internally with an
exclusive end. The sidebar explains the configured day limit and keeps invalid
input for correction.

MCP accepts a current `period` preset ID, or `period: "custom"` with both
`start` and `end`. Mixing a preset and explicit dates is refused. Omitting
`period` preserves partial-date requests: start-only ends today in UTC;
end-only uses the default preset duration ending on that day. All paths enforce
the same inclusive ceiling. A supplied MCP `accountId` is always an explicit
authorized ID; empty/reserved/unknown values cannot widen scope. Responses expose
safe `reportOptions` and identify `range.to` with `endExclusive: true`; the
performance resource uses the same default tool path.

Root HTTP schema validation now returns an actionable 400 with field path and
validation guidance before persistence. Workspace owners remain separate from
installation owners; workspace API keys cannot read or save Root policy.
Persistence failures remain generic and do not expose database details.

This closes the preset, label/default, date and filter-string policy gaps only.
General filter/error copy still needs the requested Root copy catalog. The bounded synchronous query and pagination gaps are addressed below.
Ads comparisons/exports/freshness, readable provider-owned account status, wider
module encapsulation and full legacy/MCP parity remain unfinished. No DDL, provider write or production cutover occurs.
PREVIEW_QA.md records automated and actual runtime/browser evidence separately.

## Guarded local runtime probe

Run `scripts/verify-ads-report-policy.ts` from the rebuild with a private Node
environment file and `--import tsx`. Set `DATABASE_URL` and
`REBUILD_PREVIEW_DATABASE_URL` to the same explicit loopback PostgreSQL database
whose name ends `_preview`, and `REBUILD_PREVIEW_ORIGIN` to the canonical local
HTTP origin. Production mode, other origins and database host overrides are
refused. The seeded `preview-qa@example.test` owner/workspace and example ad
accounts are required. The probe creates identifiable temporary identities,
saves the public policy through Root HTTP/MCP, reads stored example reports and
rendered pages, and finally restores the exact prior rows for all three Ads report settings and
removes its fixtures. Do not run concurrent policy edits during this temporary local check.
No provider API or production application is exercised by it.

## Bounded complete reports and paging — batch 58

Registry **53** adds two active Ads-owned Root controls:

| Setting | Default | Valid range | Runtime effect |
| --- | --- | --- | --- |
| `ads.reportPageSize` | 25 | Integer 1–100 | Account/object rows per UI page and default MCP performance rows, capped again by MCP access limits |
| `ads.reportMaxRows` | 20000 | Integer 1–100000 | Stored insight rows permitted in one complete synchronous report |

`getAdsDataset` reads the current policy, reapplies the selected/enabled current
connection and account predicates, and fetches at most `maxRows + 1`. Exceeding
the configured ceiling returns a safe correction failure before aggregation or
any result is returned. There is no truncated metric total, successful partial
report or partial result count. Root controls do not confer account access.

Trusted report-level filters apply in the database before this ceiling.
Campaign UI and MCP request only normalized campaign/ad-set/ad levels; an MCP
single-level request narrows the same query. Overview still reads all levels
because its account summaries and object counts require them. Empty/duplicate/
unknown level selections are rejected rather than dropped.

Within that complete bounded dataset, the server summarizes every matching
row before slicing displayed results. Account cards use one page; scoped
Linked/Enabled/Synced/Campaign counts still describe all matching accounts.
Campaign pages contain one slice of object summaries before account grouping;
visible object accounts alone need read/action readiness checks, while campaign
creation remains available for the selected accounts. This is server-rendered
pagination after bounded aggregation, not database object-level pagination.

Page URLs are canonical positive safe integers. Invalid/repeated/empty numbers
produce a focused correction before insight/readiness reads. A stale positive
page clamps to the last available page and displays its actual number. Empty
results show 0–0 of 0 on page 1. Previous/Next links in the contextual sidebar
preserve dates, account and period; Apply/Reset start a new first page. A safe
first-page recovery link retains the selected scope after page/limit failures.
The phone drawer closes after following a page link.

MCP retains independent object/account offsets and result counts. Performance's
default size now comes from Root instead of a second literal. Explicit paging
values must be safe JSON integers; strings, null and malformed levels are
refused before the insight query. The existing MCP result ceiling still caps an
explicit request. Account metadata retains its independent MCP cap/offset.

Summary identity is a lossless account/level/object tuple. The latest day's
object name is used, and equal-spend/equal-name results have a stable identity
tie-break. Sums, latest-day reach/frequency/CPP, daily measures, actions and raw
stored fields remain intact; currencies never merge across accounts. Ordering
is deterministic for unchanged input, not a snapshot guarantee across requests
while data or Root settings change.

These bounds limit row count, not JSON bytes or database execution time. The
account directory itself remains unpaged for filter options. Large asynchronous
reports, database-level object pagination, report comparisons/exports/freshness,
provider-owned status labels, general copy configuration, raw daily MCP detail
coverage, wider Ads/legacy/MCP parity and release gates remain open. Root numeric
forms still rely on server schemas rather than generated native min/max hints.
No DDL or provider/production change was made. PREVIEW_QA.md records actual tests,
HTTP/MCP probe, browser checks and exact local setting restoration.

Batch 59 extends these filters with complete stored daily HTTP/MCP reads and
complete-or-refused CSV, byte limits and fetch provenance. See
ADS_REPORT_EXPORT.md for canonical account/level/object inputs, output policy,
credential redactions and current limitations; PREVIEW_QA.md records evidence.
The earlier open export/daily-detail gaps are superseded at that stored-data
scope only. Database execution-time limits, async/snapshot reports, directory
paging, advanced provider metrics/management and release gates remain open.
