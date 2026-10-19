# Analytics parity: demographics, pinned metrics, comparisons, report workflows

Report-specific source/migration statements below are historical W5 notes,
superseded by [REPORT_WORKFLOWS.md](REPORT_WORKFLOWS.md) and CUTOVER.md batch82.
The remaining legacy report sections and AI recap are still required. Other
Analytics slices retain their own current evidence in the shared handoff.

Status: HOST-WIRED SOURCE AND MOCKED TESTS ONLY (account-2 W5). Demographics, personal pins and comparisons use dedicated feature IDs, scoped MCP callers, explicit result bounds and customer routes. No browser, live, real-database or production evidence exists.

## Scope and ownership
- `src/modules/analytics/{demographics,pins,comparison,reports}/**` provider-neutral services, MCP definitions, Root config tuples.
- Routes: `/api/analytics/{demographics,pins,comparison}`, `/api/analytics/report-workflows/{templates,schedules}`.
- Screens: `/analytics/demographics`, `/analytics/pins`, `/analytics/compare`, `/analytics/reports` (shared design system and shell sidebar).
- All metric data comes from the shared scoped `readAnalyticsSnapshot`; no provider names or provider tables are read here.

## Behavior
- Demographics: configurable dimensions group stored breakdown metrics; shares per breakdown; combined counts only for count units and labelled as not unique people; row cap from Root; audience coverage/as-of shown.
- Pins: personal across workspaces, stored on the user's legacy `users."pinnedMetrics"` array under a `v2:` prefix (other entries preserved); each read resolves the keys only against the current authorized workspace snapshot; unavailable pins show unknown; limit from Root; exact confirmations; audit. The checked-in Prisma `User` model has both `pinnedMetrics` and `disabledAt`; no schema migration is needed for this slice.
- Comparison: period-vs-period uses the shared `compareAnalytics` rules; group-vs-group subtracts only fully covered, same-kind, same-aggregation, caveat-free flow/stock measures. Ratios, module-caveated measures such as reach, currency totals, breakdowns, display-only totals and partial coverage stay uncompared; audience delta only with full coverage on both sides. Root's metric bound is checked against its typed range at runtime.
- MCP calls carry `allowedChannelIds` and `maxResultItems` into the service actor. Every snapshot passes the caller resource bound to the shared reader, which intersects it with current workspace access. Pins are keyed globally to the user, but values and new-pin eligibility are resolved only in the current authorized workspace. Oversized or Root-truncated MCP breakdown/comparison results are refused whole; HTTP/UI retain explicit Root truncation metadata where applicable.
- Reports: templates and schedules in legacy `report_templates` / `report_schedules`; owner/admin/editor write, others read (outside recipient addresses hidden); channel scope on schedules; Root bounds; due-run job body `runDueReportSchedules` claims with `FOR UPDATE SKIP LOCKED` and delegates generation to a host `ReportGenerationPort`. Superseded by the generation section below.

## Host integration
- The host registers `DEMOGRAPHICS_CONFIG`, `PINNED_METRIC_CONFIG` and `COMPARISON_CONFIG`; merges `analyticsDemographicsToolDefinitions`, `analyticsPinToolDefinitions`, and `analyticsComparisonToolDefinitions`; dispatches with `executeAnalyticsDemographicsTool`, `executeAnalyticsPinTool`, and `executeAnalyticsComparisonTool`; and puts `analyticsPinWriteTools` behind write confirmation.
- Module manifest pages are `/analytics/demographics`, `/analytics/compare` and `/analytics/pins`; each has its own feature ID, mapped to Analytics overview permissions and entitlement.
- Report workflow worker/MCP integration is described in the generation section below and remains port/migration dependent.
- The checked-in Prisma `User` model verifies `pinnedMetrics` and `disabledAt`; no pin migration is proposed. No real PostgreSQL query proof is claimed for the SQL pin writes.

## Limitations
- The "aiRecap" legacy option is not implemented. Report sections `goals`, `responseTime`, `destinations`, `topPosts` have no neutral reader yet; generated reports list them as not included. CSV is not attached to emails (HTML and text bodies only).
- Pin and reorder send the exact confirmation after an explicit click (own view, reversible); Unpin opens a dialog with Cancel focused. Report definition services require exact action confirmations; UI uses reviewed forms. Manual preparation confirms that it creates a download without email; HTTP/MCP require the same exact action string.
- `analytics-parity-readers.test.ts` mocks Prisma and the shared snapshot reader. `analytics-read68-contracts.test.ts` checks bounded MCP schemas, strict comparison inputs, unique demographic dimension IDs and exact pin actions. SQL text is checked against the checked-in Prisma names, but has not been exercised against PostgreSQL in this batch.

## Report generation, delivery and run history — batch82

The prior proposed SQL and port-only instructions are superseded. Use
[REPORT_WORKFLOWS.md](REPORT_WORKFLOWS.md), the installed Analytics manifest,
`src/modules/analytics/server/report-workflows.ts` and the two checksum-pinned report
migrations in CUTOVER.md. The existing Analytics CSV exporter remains separate.

Reports now have scoped UI/HTTP/MCP workflows, consumed Root settings, a distinct
worker job, durable manual artifacts and run claims, recipient intents and honest
mail outcomes. Templates remain workspace-wide; channel workflows enforce current
membership, key ceilings and usable connections. Manual preparation never sends
email and can work without SMTP. Existing templates/schedules are preserved.

See REPORT_WORKFLOWS.md for current automated, real PostgreSQL, local API/MCP,
browser, SMTP, export/erasure and migration evidence, plus unimplemented legacy
sections/AI recap and the broader release gates. This is not whole-app parity.
