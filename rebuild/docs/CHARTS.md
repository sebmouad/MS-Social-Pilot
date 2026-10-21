# Shared charts

Source: `src/components/charts/`. Import everything from `@/components/charts`.
Built on Apache ECharts with tree-shaken imports (`echarts-setup.ts`), loaded lazily
on the client, so pages without a chart do not ship ECharts. Charts are platform-neutral:
they take plain series, never provider metric names.

## Behavior shared by every chart

- **Theme.** Colors are read at runtime from CSS custom properties on `<html>`:
  `--chart-1`…`--chart-8` (categorical palette), `--chart-grid`, `--chart-text`,
  `--chart-surface`, `--chart-accent`, `--ink`, `--ink-soft`, `--line`. Nothing is hardcoded.
  Charts re-render on the `theme-change` window event and when `data-theme` or `data-mode`
  change on `<html>`. A missing variable falls back to ECharts' default for that item.
  Use `useChartEnv()` / `readChartTheme()` if another component needs the same values.
- **Lifecycle.** Initialized after mount, resized with a `ResizeObserver`, disposed on unmount.
  An unchanged option is not re-applied, so parent re-renders do not replay animation.
- **Motion.** `prefers-reduced-motion: reduce` turns animation off.
- **Accessibility.** The canvas has `role="img"` and `aria-label={label}` (`label` is required:
  write a one-sentence summary of what the chart shows). A visually hidden `<table>` carries
  the same numbers for screen readers and copy/paste (`table`, default on; `tableCaption`
  overrides the caption, which defaults to `label`). The canvas is focusable: arrow keys,
  Home and End move the tooltip across points, Escape hides it.
- **States.** `loading` shows `Skeleton`; `error` shows `EmptyState` (string is the explanation);
  no plottable data shows `EmptyState` (`emptyTitle`, `emptyHint` override copy; `empty` forces it).
- **Locale.** `locale` (`"en"` | `"fr"` or any BCP 47 tag) drives `Intl` number and date formats
  and the default copy. Dates use UTC unless `timeZone` is given, so server and client text match.
- **Unknown is not zero.** `null` values leave a gap in lines, are not drawn in bars, and show as
  `—` in tooltips and the table.
- **Sizing.** `height` (number of px or CSS length, default 280; Sparkline 40). Width is 100% of the parent.

Number formatting uses `format?: NumberFormat`:

```ts
{ style?: "number" | "percent" | "currency" | "unit"; currency?: "EUR"; unit?: "second"; compact?: boolean; maximumFractionDigits?: number }
```

Percent values are ratios (`0.25` renders `25%`). Axes use compact notation; tooltips and the table use full values.

## TimeSeriesChart

```tsx
<TimeSeriesChart
  label="Reach per day, 1–30 September"
  locale="fr"
  granularity="day"          // hour | day | week | month | year
  series={[
    { id: "reach", name: "Reach", points: [{ t: "2026-09-01", v: 120 }, { t: "2026-09-02", v: null }],
      comparison: previousPoints,   // dashed; point i is drawn at the date of primary point i
      area: true },
    { id: "clicks", name: "Clicks", points: clickPoints },
  ]}
  stacked={false}
  format={{ style: "number" }}
  comparisonLabel="August"   // defaults to "previous period" / "période précédente"
/>
```

Dates are plotted on a category axis built from the union of all series timestamps, which keeps
tick labels in the display time zone. `scale` lets the value axis start near the data (stock-like series).

## BarChart

```tsx
<BarChart label="Posts per channel" categories={["Page A", "Page B"]}
  series={[{ id: "posts", name: "Posts", values: [12, 7] }]}
  orientation="horizontal"   // or "vertical" (default)
  stacked />
```

## DonutChart

```tsx
<DonutChart label="Reach by content type" totalLabel="Total reach"
  slices={[{ name: "Photos", value: 900 }, { name: "Videos", value: 300 }, { name: "Links", value: null }]} />
```

Slices with unknown or non-positive values are not drawn but stay in the table. The center shows the sum of drawn slices.

## HeatmapChart

```tsx
<HeatmapChart label="Best times to post (engagement rate)" valueLabel="Engagement rate"
  format={{ style: "percent" }} weekStart={1}
  cells={[{ day: 1, hour: 9, value: 0.042 }]} />   // day 0 = Sunday … 6 = Saturday, hour 0–23
```

Missing cells are unknown (blank), not zero. `weekStart` defaults to the locale's first day of the week.

## FunnelChart

```tsx
<FunnelChart label="Ad funnel" stages={[
  { name: "Impressions", value: 52000 }, { name: "Clicks", value: 1300 }, { name: "Results", value: 90 },
]} />
```

The table adds conversion from the previous and from the first stage; it is unknown when the denominator is missing or zero.

## Sparkline

```tsx
<Sparkline label="Followers, last 14 days" values={[10, 12, null, 15]} labels={dayLabels} area color={2} />
```

Bare line for metric cards: no axes, tooltip on hover/focus. Pass `table={false}` where many sparklines
repeat the number already shown in the card.

## AudiencePyramid

```tsx
<AudiencePyramid label="Audience by age and gender"
  groups={["18–24", "25–34", "35–44"]}            // youngest first (bottom)
  left={{ name: "Women", values: [30, 45, 20] }}
  right={{ name: "Men", values: [25, 38, null] }}
  format={{ style: "number" }} />
```

Both sides use one symmetric axis; values are always shown as positive numbers.

## Facebook collection and reaction provenance (2026-10-21)

Source changes in `src/platforms/facebook/post-history.ts` select a valid,
nonempty `post_reactions_by_type_total` breakdown before a reaction summary,
then a fully read set of configured reaction-type edges. Counts from competing
sources are never added. An insight zero is authoritative; an empty or invalid
breakdown is unknown. `reactions` and `reactions_<type>` use one selected source.
The raw insight breakdown remains stored. `reactionProvenance` retains the
selected source, metric identity, insight/summary/edge totals, edge-type counts,
configured-edge completeness, disagreement flag and collection observation time.
Partial edge counts remain in provenance, without becoming a complete total.
This prevents the recorded summary 0 / insights 1 mismatch from replacing 1 with
0. It does not explain Meta's discrepancy; provider lag remains unproven.

History reads every configured metric independently and retains scalar and
structured values. Fixture coverage exercises `post_media_view`,
`post_total_media_view_unique`, `post_reactions_by_type_total`, `post_clicks`
(normalized to `clicks`) and `post_clicks_by_type`, including `total_value`
responses. Configured `post_video_*` metrics are requested only for posts
positively identified by `status_type=added_video` or video attachment metadata,
including nested attachments. Unknown media type is not assumed to be video.

The content insights loader now treats lifetime paging links as time-window
links, and retains lifetime points without `end_time` when an explicit requested
end is available. That end is a snapshot anchor, not an occurrence timestamp.
Lifetime totals remain lifetime snapshots; non-lifetime totals retain their
explicit range identity. Content discovery and Ads still enforce full bounded
pagination. Page follows/views remain independently configured requests: one
rejected metric does not erase successful observations.

Evidence: fixture tests only (`tests/facebook-post-history.test.ts` and
`tests/facebook-data-coverage.test.ts`). No fresh Graph eligibility, complete
history, browser, transport parity or production evidence is established here.
Neither new Root keys nor a schema-version change are included.

Required integration outside this lane:

- In `src/platforms/facebook/config.ts`, add `post_clicks` to the
  `meta.postHistoryPolicy` default metrics. Review persisted Root overrides too;
  changing a default does not update an existing policy.
- Configure version/grant-verified video metrics in that policy and retain
  `status_type` in its fields; add `attachments{media_type,type,subattachments}`
  if attachment-based video detection is needed. Alternatively configure the
  existing `meta.contentInsightCollections` video/video-insights path. The
  fixture metric names demonstrate transport behavior, not v26 eligibility.
- Review `meta.pageInsightMetrics` in `src/platforms/facebook/module.ts` and
  persisted Root settings for the desired eligible follows/views measures,
  including `page_total_media_view_unique`, and compatible
  `meta.pageInsightPeriods`. No speculative metric list is injected by loaders.
- Extend the existing `meta.metricLabels` bilingual catalog for the selected
  metrics. Full customer presentation of nested post click categories and
  provenance, and correct duration units for video watch-time charts, remain
  separate work; the neutral analytics unit contract currently lacks duration.
- Recollect historical snapshots to replace previously stored edge-derived
  canonical totals. This change does not rewrite existing records. An integrator
  owns configuration versioning and updates to architecture/handoff documents
  outside this worker's ownership.

## Tests

`tests/charts-options.test.ts` (props → option mapping per chart, formatting),
`tests/charts-render.test.ts` (jsdom with ECharts mocked: states, table fallback, theme events,
keyboard tooltip, dispose), `tests/charts-setup.test.ts` (every option rendered through the real
tree-shaken registration to SVG). Not covered: pixel rendering and real browsers; check each chart
across the four themes at 1440px and 390px when first used on a screen.
