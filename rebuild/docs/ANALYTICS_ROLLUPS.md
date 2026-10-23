# Analytics rollups

Analytics-owned precomputation with per-platform stored-data mappers
(Facebook today). The nightly `analyticsRollups` worker job folds stored
Page insights into one value per channel, metric and day
(`analytics_rollup_daily`), then folds those into Monday-to-Sunday weeks
(`analytics_rollup_weekly`). Overview, explorer and comparison reads
prefer the rollups when a fresh worker run covers the request and fall
back to detailed stored reads otherwise. No provider request is made
anywhere in this pipeline.

Status: source/unit evidence only (mocked compute, coverage, guard and
mapper checks in `tests/analytics-rollups.test.ts`). No production
timing comparison is recorded here.

## What is precomputed

- Daily rows cover day-period channel metrics only: one value per
  (channel, metric, day). Flows sum every stored observation of the day;
  stocks keep the latest observation of the day (ties resolve to the
  latest fetch). Rows without a numeric observation contribute nothing.
  The aggregation mirrors the read mapping exactly, so the daily path
  returns the same series as the detailed path.
- Weekly rows derive from daily rows, never from raw insights: flows sum
  the week, stocks keep the latest day. Weekly points date at the Monday
  week start.
- Breakdowns (object/array-valued rows), non-day periods, audience, ads
  and post cohorts are never rolled up; they always read in detail.

## Worker coverage

- Schedule: `analytics.rollups.schedule` (default `30 1 * * *`, after
  the day's late syncs). Policy: `analytics.rollups.policy`
  (`dailyLookbackDays`, `backfillDays`, `weeklyThresholdDays`,
  `batchTargets`, `runHistoryDays`, transaction bounds).
- Each run recomputes the hot lookback per channel (default 7 days, the
  Page sync lookback, so late-arriving syncs are absorbed) and backfills
  cold channels up to `backfillDays` (default 400). Channels beyond
  `batchTargets` stay uncovered until the batch size grows; the run is
  then recorded `partial`.
- Every run records one coverage row per workspace, provider and
  granularity in `analytics_rollup_runs` (window, processed channels,
  status). Coverage rows older than `runHistoryDays` are deleted.
- Suspended and purging workspaces are skipped. Read-time authorization
  still decides who may use the rows, so no plan check happens here.

## Read preference

A run qualifies a read only when it finished today (every rolled complete
day saw the whole day's syncs), its window starts at or before the
request, and it processed every selected channel:

1. Ranges longer than `weeklyThresholdDays` (default 120) try the weekly
   path first: full weeks as weekly points, partial edge weeks as daily
   points so totals stay exact. A catalog note
   (`meta.pageAnalyticsCopy.rollupWeeksNote`, EN/FR) discloses the weekly
   points on every affected day-series metric.
2. Otherwise the daily path covers complete past days; the current day
   always reads in detail, so intraday syncs stay visible.
3. Anything uncovered (no fresh run, uncovered channel, missing tables
   mid-deploy, or object-valued day rows in the span) reads in full
   detail. The daily path is output-identical to detailed reads; only the
   weekly path changes point granularity, and only with its note.

Goal, destination and post-performance measures stay on detailed reads;
rollups serve the channel day-series in overview, explorer and compare.
