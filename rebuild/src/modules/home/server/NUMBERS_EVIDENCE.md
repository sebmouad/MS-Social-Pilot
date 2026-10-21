# Reporting numbers: synthetic fixture evidence (2026-10-21)

This lane changed the shared Analytics aggregator and tests only. No provider,
production database, browser, server, deployment or remote Git operation ran.
The fixtures model ten Pages, sparse Page insights, numeric post snapshots,
provider decimal spend strings preserved in `fields`, normalized numeric spend,
a USD account with retained daily insights through October 16, and four Ads
hierarchy levels. They are not production records.

| Card / metric | Before | After / verified behavior | Evidence |
| --- | --- | --- | --- |
| Analytics empty stock / latest-per-resource total | 0 despite no observations | null; a stored zero remains 0 | `analytics-numbers-production-shape` (failed before fix) |
| Analytics stock / overlapping-window daily chart | Same-resource snapshots 100 + 120 plus another resource 30 = 250 | Latest snapshot per resource/day: 120 + 30 = 150 | `analytics-numbers-production-shape` (failed before fix) |
| Analytics post views, unique views, reactions, comments, clicks | No change | 16,500; 13,200; 165; 30; 60 over 20 posts / 10 Pages; unique counts disclose overlap | `analytics-numbers-production-shape` |
| Analytics / Home audience | No change | Latest snapshots: 2,800; 8/10 coverage, measured zero retained | `analytics-numbers-production-shape`, `home-overview-service` |
| Home views / engagements / changes | No change | 3,600 / 360; prior comparable sums 1,680 / 168; changes 25%, 8 covered / 6 comparable | Same tests |
| Home reaction mix / top channel | No change | 36 reactions; highest measured channel 80 engagements | `home-overview-service` |
| Home heatmap average / measured posts | No change | Channel-relative scores averaged equally; 2x across 10 channels; 30 measured posts; Casablanca weekday/hour conversion | `analytics-numbers-production-shape`, `home-overview-pure` |
| Home upcoming / inbox counts | No change | Shared-service totals 40 upcoming and 17 open; independent of rendered item count | `home-overview-service` |
| Home spend / recorded days | No change | USD 31, two retained days, last October 16; absent later days not filled with zero | `home-ads-production-shape`, `home-overview-service` |
| Ads spend / impressions / clicks / actions | No change | 31 / 1,000 / 100 / 100 independently at campaign, ad-set and ad levels; account spend counted once | `home-ads-production-shape` |
| Ads / Analytics CPC / CPM / CTR | No change | 0.31 / 31 / 10%; calculated from sums instead of daily averages | `home-ads-production-shape`, `analytics-numbers-production-shape` |
| Ads / Analytics reach / CPP / frequency | No change | Latest day: 600 / (20.75 / 600) / 1.5; not a deduplicated full-period measure | Same tests |
| Currency / undefined ratios | No change | USD/EUR separate; denominator-zero CPC/CPM/CTR null | `home-ads-production-shape` |
| Periods | No change | Inclusive UTC calendar dates; Ads reads exclusive next midnight; adjacent Analytics comparison periods disjoint | Same tests, `analytics-comparison` |

## Integration work outside this lane

- `src/platforms/facebook/goals.ts` reads only `page_insights`; it cannot supply
  Home performance from the post insights used by Analytics when Page insights
  are absent. Add an explicit, labelled post-cohort measure path in the Facebook
  adapter, with the appropriate neutral service contract if needed. Do not
  silently combine daily Page flows and lifetime post snapshots.
- `src/platforms/facebook/destination-measures.ts` reads app post-target insights
  only. It misses external-post snapshots (including app posts whose insights
  are stored only on the linked remote copy). The provider owner needs a scoped,
  deduplicated projection across `remotePostId` / remote id, with configurable
  bounds and explicit coverage.
- `src/platforms/facebook/post-performance.ts` already joins the remote snapshot
  and excludes matching app posts from its external UNION. Existing tests check
  SQL shape, not execution against PostgreSQL; this lane does not establish
  actual join/deduplication behavior on database rows.
- Home audience trend lookup compares unqualified audience metric names with
  namespaced, period-qualified Analytics keys. The provider/shared data contract
  needs an exact neutral series identity (and service tests), avoiding string
  guessing in shared Home code. No trend is safer than a mismatched trend.
- Post-series normalization in `src/platforms/facebook/analytics.ts` retains
  scalar measures, not nested `post_reactions_by_type_total` categories. Retained
  nested metrics need provider-owned breakdown mapping and coverage tests.
- `docs/ARCHITECTURE.md` and `docs/AGENT_HANDOFF.md` should record these two shared
  aggregation fixes and unresolved adapter gaps. They are outside owned paths.

No Root keys or schema changes. No UI component/screen edits. User-visible
changes are unknown stock totals and corrected daily stock/window charts;
existing English/French labels continue to apply. Fixture/mock evidence does
not establish exhaustive coverage of every dynamic provider metric, actual
PostgreSQL bounds/deduplication, live-provider accuracy or production behavior.
