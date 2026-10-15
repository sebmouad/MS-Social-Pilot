# Analytics

Analytics reads the stored `PageInsight` and `AdInsight` records through
`src/server/analytics/data.ts`. The page discovers metric names from the rows
returned for the selected channels and date range, so metrics that were not
stored are not invented or displayed as zero.

Page metrics with a numeric value are charted over the selected dates, with each
stored period kept as its own series. Breakdown objects in `PageInsight.value` are shown as category tables. `page_follows`,
`page_fans`, and `page_fans_online_per_day` are treated as stock values; they
use each channel's latest value rather than summing repeated snapshots. The
audience summary uses the latest `page_follows` or legacy `page_fans` row once
per selected Page, preferring `page_follows` when timestamps tie. It reports
how many selected Pages have a stored audience value and lists Pages without
one.

Advertising insight reads use the account level only, which avoids adding
account, campaign, ad set, and ad rows together. Stored scalar delivery values
and numeric extras in `AdInsight.fields` are discovered dynamically. Action
arrays in `AdInsight.actions` and retained fields are flattened by action type.
Spend is shown per account and currency; a combined spend total is suppressed
when selected accounts use different currencies. Date and channel filters are
submitted from the Analytics sidebar and applied to the stored rows.

Run `npm run typecheck` and `npm test` from `app/rebuild` after analytics
changes.
