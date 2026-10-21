# Short-link reporting — local parity round 8

Owned source: Analytics reports only, tests and the Reports inventory status cell.
Legacy references: `src/lib/reports.ts` lifetime click accounting and destination
rows; `prisma/schema.prisma` ShortLink/LinkClick; legacy per-click retention semantics.

Three stored-data report capabilities are added to the existing Destinations
section: a per-link inventory with lifetime totals; retained period clicks per
link; daily UTC retained clicks. These extend the existing report workflow and
require no new screen, route or tool. Prepare report in the UI, session REST
`/api/analytics/report-workflows/run`, key REST
`/api/v1/analytics/generate_report` and MCP `generate_report` still call the shared
confirmed/authorized/audited `runReportNow` and generator. Root's existing
`analytics.reportDocumentCopy` catalog supplies the new English/French labels
and coverage notes. CSV, JSON, printable HTML and text include the same views.

`server/link-report.ts` is an internal read after the generator's current actor,
feature, credential and channel authorization. A single SQL statement reads a
consistent cohort and independent bounded views. The cohort contains short links
on posts currently published to the selected channel during the inclusive UTC
report period. It is not every click made in that period on all older posts.
Links attributed to that channel qualify; legacy links without targetId qualify
only when the post has exactly one currently published destination. Ambiguous
shared links are excluded, never divided or attributed using another channel's
identity. Posts, short links and targets have workspace predicates. The query
never projects visitor metadata, destination URLs or slugs.

Lifetime totals are ShortLink running counters. Period counts use retained
LinkClick timestamps within the report period and preserve zero from the left
join. Zero means no retained records, not no historical clicks. Historical
retention can remove rows, so no completeness/unique-visitor claim is made.
Daily counts use the entire eligible cohort independently of inventory clipping;
days without retained clicks are omitted, not fabricated. Link ordering is
lifetime descending/ID ascending; daily ordering is date ascending. One extra
row detects clipping for each view separately.

New typed Root setting `analytics.reports.linkDetails` has `links` and `days`
limits, validated before the query and read with runtimeConfig. Existing report
row/byte/credential bounds still apply; source and output clipping are disclosed.
CONFIG_SCHEMA_VERSION is deliberately unchanged for the integrator.

Verification from rebuild/: `npx tsc --noEmit -p .` — 0 errors.
`npx vitest run --cache=false` with these targeted files — 10 files, 155 tests
passed:

- tests/report-link-details.test.ts
- tests/report-link-details-workflow.test.ts
- tests/report-document-copy.test.ts
- tests/report-publication-details.test.ts
- tests/analytics-parity-report-generation.test.ts
- tests/analytics-parity-reports.test.ts
- tests/reports82-http-host.test.ts
- tests/reports82-mcp-host.test.ts
- tests/reports82-ui.test.ts
- tests/report82-engine-manual.test.ts

The new tests use query-shape checks and mocked rows/workflows; they do not prove
PostgreSQL execution, real client transport, browser downloads, performance at
production volume, provider data completeness or production. Existing HTTP/UI
host tests verify delegation/rendering, not a new browser session. No servers,
whole suite, production operations, commit, push or deployment were run.

Integrator edits outside ownership: bump CONFIG_SCHEMA_VERSION for the new key
and expanded document catalog, and record this local source/test scope and the
pending PostgreSQL/browser/client checks in ARCHITECTURE.md, DELIVERY_PLAN.md and
AGENT_HANDOFF.md. No migration or new route registration is needed.
