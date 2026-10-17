# Stored Ads daily details and CSV — batch 59

## Ownership and scope

Ads owns `modules/ads/server/access.ts`, `report-read.ts` and `export.ts`.
HTTP and workspace MCP call these services. Current active user, membership,
workspace availability, Ads campaigns entitlement/read permission, member channel
grants, caller channel restrictions and selected enabled account/provider scope
are independently enforced. Installation authority does not bypass customer
authorization. Read access does not grant campaign management.

`GET /api/ads/report/rows` and `get_ads_report_rows` expose every stored scalar
measure, actions and additional fields, with account/currency/object identity,
report date and `fetchedAt` provenance. An older row without fetch provenance
returns null; its report day is never substituted. `msp://ads/daily` is the default
bounded daily page. Continue tools/API reads with `nextOffset` until null.

`GET /api/ads/report/export` and `export_ads_report` prepare a complete CSV or
refuse the request. The sidebar exports applied filters across all report pages,
including account, campaign, ad-set and ad levels. Levels and currencies are
separate observations; neither overlapping levels nor daily reach should be
summed as unique people. No provider request or management operation is sent.

Canonical inputs are `period`, `start`, `end`, `accountId`, `level`, `objectId`;
daily reads also accept `offset`, `limit`. Dates are inclusive UTC days and
`range.to` is exclusive. Omitted level includes all stored normalized levels.
An object ID requires one explicit accessible account and level. Unknown fields,
duplicate HTTP parameters and malformed values fail without broadening scope.
Daily sorting is date descending, then account/level/object/row identity.
Offsets do not freeze data across requests.

## Policy and output protocol

Registry **54** installs active Ads-owned Root controls:

| Setting | Default | Accepted range |
| --- | --- | --- |
| `ads.detailMaxBytes` | 1,048,576 | 1,024–10,485,760 |
| `ads.exportMaxBytes` | 10,485,760 | 1,024–52,428,800 |
| `ads.exportFileName` | `ads-report.csv` | Safe ASCII CSV basename, at most 100 characters |

These consume the existing date policy and dataset row/page ceilings. Invalid
output policy fails closed with customer-safe copy. The detail bound measures
the complete compact JSON application result; MCP transport additionally wraps
that result as structured content and formatted text. MCP's current result cap
limits detail pages and the **total** exported rows. Export never silently takes
the first MCP page. An oversized row set or UTF-8 file returns no partial CSV.

CSV v1 columns live in `modules/ads/report-csv.ts`: identity, report/fetch dates,
all stored scalar metrics, `actions_json`, `fields_json`, `redacted_paths_json`.
Records use CRLF and UTF-8; strings are consistently quoted and formula-like
strings are prefixed with an apostrophe, including whitespace/BOM and full-width
formula markers. Finite typed numeric negatives stay numeric. CSV is a report,
not a workspace archive or an Ads import template.

HTTP responses/errors are `no-store`. Downloads require `text/csv`,
`x-msp-export-format: ads-daily-v1`, valid `x-msp-row-count`, exact
`x-msp-export-bytes` and a safe matching Content-Disposition filename. The shared
`CsvExportButton` is also used by Publishing. It deduplicates pending clicks,
focuses safe feedback and cancels/ignores stale or unmounted requests. Prepared
CSV confirms the application receipt; it does not assert that the browser saved
a file. Error feedback retains filters and supports a fresh read retry.

## Credential handling and limitations

The neutral serializer removes credential-named nested fields, signed credential
parameters, URL userinfo and fragments, recording explicit JSON paths. Generic
JSON properties named `key` and metrics such as `token_count` are retained;
ambiguous URL query `key` is treated as sensitive. Existing stored-field UI uses
the same sanitizer. The scrub is name-based, not a guarantee that arbitrary
unlabelled text cannot contain a secret. Unsupported JSON, cycles, invalid dates
and nonfinite measures fail safely instead of being silently changed to null/zero.

Daily UI expansions share one presentation of scalar measures, actions,
additional fields and fetch provenance. Summary totals retain existing semantic
rules; additional fields are preserved without invented aggregation. Synchronous
dataset aggregation still loads the complete bounded result before paging;
asynchronous exports, cross-request snapshots and comprehensive new metric
visualizations remain work. Stored coverage is not proof that every provider
metric was fetched, that Ads management is complete, or that live Facebook,
legacy parity, migration/rollback and production gates have passed.

See [PREVIEW_QA.md](PREVIEW_QA.md) for actual verification evidence.
