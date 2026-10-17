# Ads report filter scope and correction — batch 56

## Current behavior

Ads owns pure filter interpretation in `src/modules/ads/report-filters.ts`.
The database read boundary remains `server/ads/queries.ts`; its re-export keeps
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

The preset catalog/default and newer correction copy still require the target's
Root-managed configuration/copy catalog. UI range ceilings need consolidation
with the existing MCP policy, and complete report pagination, comparisons,
freshness/status presentation, exports and broader Ads workflows remain open.
This batch does not claim all Ads logic is physically encapsulated, all controls
are Root-managed, or the app/core design is complete.
