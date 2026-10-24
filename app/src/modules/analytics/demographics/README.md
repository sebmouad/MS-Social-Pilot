# Stored audience history

The Facebook storage loader supplies neutral `breakdownHistory` snapshots to
Analytics. The catalog and aggregator preserve that optional field without
provider branching. Each snapshot identifies its resource, provider measurement
end time (`asOf`), fetch time and original category labels/values. Re-fetches at
the same resource/metric/period/time use the newest fetch. Different stored
periods remain different metrics. The existing loader limits storage reads to
the selected UTC period and currently authorized selected resources.

`readDemographics` is the shared UI, HTTP and MCP read boundary. It reuses current
Analytics authorization and resource selection; CSV uses that same result, with
`format=csv` on `/api/analytics/demographics` or `get_analytics_demographics`.
The MCP resource retains the JSON history. Category values absent from a
snapshot are not synthesized. Unreadable values stay null (`Not available` in
English, `Non disponible` in French). Shares apply only within a complete count
snapshot with positive total. Dates and source metrics are never summed.
Coverage counts distinct resources with at least one numeric category in the
period; oldest/newest snapshot timestamps are also exposed. No coverage means
unknown audience, not a zero audience.

Full history ignores the latest-summary category display cap. The existing
`analytics.reportExportRows` bounds snapshot-plus-category items; oversized
requests fail with narrowing guidance, rather than silently truncating. MCP's
caller result bound also counts history items. CSV includes every category,
resource and timestamp, quotes cells and neutralizes spreadsheet formulas.
No new Root keys, schema changes or migration are required.

Evidence: `tests/analytics-demographics-history.test.ts` covers storage mapping,
neutral propagation, shares, unknown values, re-fetch selection, CSV, service
scope forwarding and bounds. `tests/analytics-demographics-surfaces.test.ts`
covers server-rendered English/French history, filter recovery and HTTP JSON/CSV
and denial paths. These are synthetic unit/render checks; no browser, actual
PostgreSQL, live-provider or production evidence is claimed.

Validation for this branch: 72 targeted tests across 9 files passed, including
`tests/raw-sql-void-guard.test.ts`; `npx tsc --noEmit -p .` passed from `rebuild/`.
The attempted full suite was interrupted after encountering missing DATABASE_URL,
loopback-listener failures and an existing manifest expectation missing the
`/analytics/posts` route (also reproduced in isolation). No full-suite pass is
claimed; no app server, deployment or live-provider operation was performed.
