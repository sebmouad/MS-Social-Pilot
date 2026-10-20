# Stored ad-object analysis

`/analytics/ads`, `GET /api/analytics/ad-objects`, MCP
`get_analytics_ad_objects` and resource `msp://analytics/ad-objects` share
`readAdObjects`. Read access uses `analytics/ads`, the Analytics overview
permission/plan switch (central mapping is pending the requested ownership expansion). The service rechecks disabled accounts, membership,
entitlements (without installation-owner inspection), role permissions, purge
state, current channel grants, credential target/account ceilings and selected
connection visibility. It reuses Ads' neutral stored account/dataset readers and
platform-owned `parentObjectId`; shared code interprets no provider fields.

## Semantics and UX

Filters, level/account choices, pagination, return-to-campaigns and CSV live in
the contextual sidebar. The shared Button, DataTable and form primitives inherit
the design system. English/French loading, empty, recovery and detail copy is
provided. Recovery keeps filter input; native disclosures expose all dated
metrics, ratios, actions, additional fields and redaction provenance.

UTC start/end days are inclusive. Each account/object/level/currency is separate;
levels overlap and are never combined. Duplicate object-days use newest fetch
and stable record-ID ties. Spend, impressions and clicks sum stored days only;
coverage is stored days / requested days, never an assertion of complete data.
CPC/CPM/CTR are calculated from those same flows, with zero denominators unknown.
Reach/frequency/CPP use the latest stored day, not a period sum. Unknown values
stay null; missing rows never turn into zero-valued metrics. Existing persisted
numeric zeros are treated as stored figures: historical ingestion defaults cannot
be distinguished from reported zeros by this reader. No historical repair is
claimed. Additional measures remain individual dated observations, without
invented aggregation rules.

Currency is current account metadata, not proven historical currency. There is
no conversion or cross-account monetary total. Each drill-down binds one account
and stored parent at the previous level in the same period. Unknown/conflicting
lineage is counted and excluded from parent-filtered results. An unfiltered level
still exposes objects without known parents. No remote fetch is performed;
missing historical objects/lineage must be populated by the owning platform.

CSV includes every filtered summary and dated observation, independent of the
current UI page; columns identify UTC period, currency source, level, lineage,
coverage, snapshot day and fetch time. Credential-key redaction reuses the neutral
Ads normalizer. CSV quotes and formula prefixes are escaped. Unrecognized secrets
inside opaque source strings retain the existing normalizer's limitations.

## Root controls and bounds

Declared only in the owning Analytics `config.ts`:

- `analytics.adObjects.pageSize`: 25, range 1–200.
- `analytics.adObjects.maxRows`: 10000, range 1–100000.
- `analytics.adObjects.maxBytes`: 2000000, range 1024–20000000.

Existing Analytics default/max days and Ads stored-read row bounds also apply.
JSON and CSV refuse oversized reads rather than truncate. CSV row bounds include
summaries and daily observations; JSON/CSV combined serialized bytes are bounded.
MCP counts summaries, daily observations and account choices against its result
cap and asks for narrower filters when exceeded. This is intentionally
conservative; a single long object history can require a shorter date range.
No migration or provider change. Central registry/schema-version editing was
explicitly excluded; integration must perform its normal version bump for these
keys.

## Verification and continuation

From `rebuild/`: `npx vitest run --config
src/modules/analytics/ad-objects/vitest.config.ts` covers aggregation, current
access/resource ceilings, parent scoping, complete exports, limits, HTTP/MCP
sharing and bilingual server rendering with realistic synthetic mocked data.
Run the SQL void guard and `npx tsc --noEmit -p .` as well.

Browser/theme/phone/keyboard/download interaction, real PostgreSQL, actual MCP
transport and production evidence remain open. No servers, installation,
generation, push or deployment belong to this batch. Root schema-version bump
remains the integrator's work because registry.ts is outside ownership.

Current integration blocker: `analytics/ads` must be added to
`FEATURE_ROOT_SWITCH` in `src/server/entitlements/index.ts` and
`FEATURE_MODULE_SWITCH` in `src/server/permissions/index.ts`, each mapped to
`analytics/overview`; `tests/mcp-security.test.ts` needs the corresponding true
feature fixture. These three edits were requested asynchronously and remain
unapplied pending user approval because they exceed assigned ownership.
Until integrated, the new feature is denied and TypeScript reports those three
missing entries. This batch is not release-ready.

Latest checks (2026-10-20): 25 module-local tests pass; SQL void guard plus
existing Ads parent/scope/ceiling tests pass (19). `npx tsc --noEmit -p .` is
blocked by the three missing central feature entries above, with no errors in
owned source. The repository-wide Vitest run reported five loopback socket
`EPERM` failures in `tests/facebook-native-http.test.ts` and the stale
`tests/module-manifests.test.ts` Analytics navigation assertion (already missing
the existing Posts route, now also needs Ad objects). The run was interrupted
after output stopped rather than claiming a complete suite pass. Other suites
logged missing database configuration; database tests were skipped. No full-suite
success, real database execution or listening server is claimed.

A read-only independent review found and prompted regression fixes for per-day
CSV parent provenance and HTTP 401/403 session handling. Fresh targeted checks
include both fixes. Integration should also update the stale navigation fixture,
the parity/architecture/UX/shared handoff docs, and run full release-scope proof;
those shared documentation files were outside this task's file ownership.
