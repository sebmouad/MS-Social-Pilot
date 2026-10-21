# Publication distributions — round 10

Ownership: Analytics module, targeted tests and the Reports inventory status cell.
This extends the legacy Reports/CSV and analytics breakdown requirements; it does
not close the full inventory row or replace engagement-based best-time analysis.

The Published posts report section now includes three saved-data views:

- publication counts by ISO weekday, Monday 1 through Sunday 7;
- publication counts by UTC hour, 0 through 23;
- publication counts by current stored attempt counter, with a configurable final
  bucket meaning that many attempts or more. Zero means no recorded attempt.

Only currently published destinations in the authorized workspace/channel and
inclusive UTC report period qualify. Other channels, provider errors and private
visitor data are not projected. Negative attempt counters are excluded from that
view. These are counts of saved publications, not engagement, recommended times,
immutable attempt history or proof of provider delivery. Empty buckets are omitted.

A single aggregate statement reads all three views consistently and independently
of bounded content logs. Its result has finite weekday/hour domains and a Root-
bounded attempt domain. Existing artifact row/byte and credential ceilings still
apply. Existing logs and aggregates are separate statements, so a concurrent
publication can produce slight differences between their snapshots.

## Root configuration

No new registry key. `analytics.reports.publicationDetails` gains typed fields
`weekdayBreakdown`, `hourlyBreakdown`, `attemptBreakdown` (default true), and
`attemptBucketCeiling` (default 10, range 1–100). Older stored objects acquire these
validated defaults without a write. Root may disable each view; disabling all
three avoids the aggregate query. The existing `analytics.reportDocumentCopy`
EN/FR catalog gains view labels and an explicit scope/counter explanation.
CONFIG_SCHEMA_VERSION is unchanged for integration.

## UI / REST / MCP mapping

No new route or tool. Prepare report in `/analytics/reports` with Published posts,
session REST `/api/analytics/report-workflows/run`, key REST
`/api/v1/analytics/generate_report` and MCP `generate_report` use `runReportNow`.
That existing shared service owns current identity, tenant/channel/credential
scope, feature access, exact confirmation, request reuse and audit. Its generator
calls the internal reader after authorization and renders the same rows into
CSV, JSON, printable HTML and text. No transport-specific product rules added.
The existing MCP parity row remains applicable; no new tool row is needed.

## Evidence and remaining work

Targeted tests cover scoped/date SQL predicates, deterministic independent
aggregation, Root switches/ceiling, English/French artifacts, output clipping,
service/MCP confirmed generation and audit, and denial before distribution reads.
Existing UI/HTTP/MCP host tests verify delegation and rendering. All are local
unit/mocked/query-shape evidence. No PostgreSQL query execution, browser download,
real-client, production-volume or provider evidence was obtained. No server,
deployment, push or production action was performed.

Integrator-owned edits needed: update ARCHITECTURE.md, GOAL.md, DELIVERY_PLAN.md
and AGENT_HANDOFF.md with this batch and its limited evidence; apply the normal
schema-version policy for the expanded existing JSON setting and copy catalog.
There is no migration or app-route change to integrate.
