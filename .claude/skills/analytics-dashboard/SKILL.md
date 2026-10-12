---
name: analytics-dashboard
description: Build or change MS Social Pilot analytics — KPI cards, charts, multi-profile totals/compare/table, metric explorer covering every Meta metric, demographics, post tables. Use for anything under /analytics, the dashboard numbers, reports' data modules or analytics exports.
---

# Analytics dashboards

Read first: `docs/ai/NEXT_PHASES.md` Phase B, `docs/ai/META_API_NOTES.md`
(verified real-data facts), `docs/inspiration/simplified/PATTERNS.md §2`.
Also load `dataviz` before designing a chart and `profile-selection` for scope.

## Data
- Metric catalogue: `src/lib/facebook/metrics.ts` — `PAGE_METRICS`,
  `POST_METRICS`, `VIDEO_METRICS`, `IG_ACCOUNT_METRICS`, `IG_MEDIA_METRICS`,
  `AD_INSIGHT_FIELDS`, `REMOVED` (withdrawn, with date and replacement),
  `CATEGORY_LABELS`, `findMetric()`. Add new metrics there with a plain name and
  description (en + fr messages), never raw Graph names in the UI
  (`PLAIN_NAMES` in `src/lib/analytics.ts`).
- Fetch through `src/lib/facebook/graph.ts` (appsecret_proof, paging) and respect
  `budget.ts`. For 2+ profiles read stored snapshots; don't fan out live calls on
  page load.
- Known traps: reactions via `reactions.summary(total_count)`; follows by
  country/city need `period=day`; impressions/reach retired → `*_media_view`;
  age/gender and locale gone.

## Aggregation across profiles (must match NEXT_PHASES §B2)
Sum counts · unique people not additive (label "up to N", show per profile) ·
followers = sum of latest values · rates recomputed from summed parts · money
grouped by currency. Put each rule in a pure function in `src/lib/` with unit
tests and in the metric's ⓘ text.

## UI
- 1 profile → deep Page view. 2+ → `.segmented` Total · Compare · Table.
- KPI card: label, value (`.nums`), change pill with arrow, sparkline; cards
  toggle chart series; one axis per unit; legend toggles per-profile lines
  (max 8, then "Others").
- Every chart in `ChartFrame` (table view) with ⓘ; shared hover tooltip.
- Withdrawn metrics greyed with "Meta stopped providing this on <date>".
- Show freshness with `AutoSyncNote` ("Last read …"). Never a pull button: the
  worker reads Facebook, within the Meta call budget (`budget.ts`).

## Verify
Unit tests for each aggregation rule; e2e on seeded multi-Page data; live in the
owner's Chrome: totals must equal the sum of each Page's numbers in Facebook's
own Insights (`live-facebook-test` skill, read-only — no posting needed).
