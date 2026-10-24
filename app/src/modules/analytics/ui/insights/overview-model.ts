import type { MetricView } from '@/modules/analytics/server/aggregate';
import type { AnalyticsComparisonValue, AnalyticsSnapshot } from '@/modules/analytics/server/types';
import type { PinnedMetricView } from '@/modules/analytics/pins/contracts';
import { fillInsights, type InsightsCopy, type InsightsPolicy } from './insights-config';
import type { InsightsTile } from './InsightsTiles';
import type { ChartMetric } from './MainChartCard';
import { formatDay } from './period';

type Locale = 'en' | 'fr';

export function formatMetricValue(value: number, unit: string, locale: Locale): string {
  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(value);
  return unit === 'percent' ? `${amount}%` : unit === 'multiple' ? `${amount}×` : amount;
}

/** First stored channel metric whose label contains one of the policy words (words are tried in order). Breakdowns are never a headline number. */
export function pickMetric(metrics: readonly MetricView[], words: readonly string[]): MetricView | undefined {
  const candidates = metrics.filter(metric => metric.resourceKind === 'channel' && metric.kind !== 'breakdown');
  for (const word of words) {
    const needle = word.toLowerCase();
    const hit = candidates.find(metric => metric.total !== null && metric.label.toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return undefined;
}

function deltaOf(metric: { kind: string; unit: string }, comparison: { status: string; delta: number | null; percent: number | null } | null | undefined, locale: Locale, copy: InsightsCopy): InsightsTile['delta'] {
  if (!comparison || comparison.status !== 'comparable' || comparison.delta === null) return undefined;
  const ratio = metric.kind === 'ratio' && metric.unit === 'percent';
  const amount = ratio ? comparison.delta : comparison.percent;
  if (amount === null) return undefined;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(amount);
  return { label: ratio ? fillInsights(copy.tilePoints, { value: number }) : `${number}%`, direction: amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat', comparedTo: copy.tileVsPrevious };
}

type Context = { copy: InsightsCopy; locale: Locale; period: { start: string; end: string } };

function comparisonNote(comparison: AnalyticsComparisonValue | undefined, copy: InsightsCopy): string | undefined {
  if (!comparison) return undefined;
  if (comparison.status === 'coverage_changed') return copy.infoCompareCoverage;
  if (comparison.status === 'missing' || comparison.status === 'not_comparable') return copy.infoCompareMissing;
  return undefined;
}

function dateText(value: Date | null | undefined, locale: Locale) {
  return value ? formatDay(value.toISOString().slice(0, 10), locale) : null;
}

/** A number tile from a stored metric. Every qualifier goes into the ⓘ blocks; partial coverage turns it into ⚠. */
export function metricTile(id: string, label: string, metric: MetricView, comparison: AnalyticsComparisonValue | undefined, context: Context): InsightsTile {
  const { copy, locale, period } = context;
  const partial = metric.coverage < metric.available;
  const latest = dateText(metric.latestAt, locale);
  const synced = dateText(metric.updatedAt, locale);
  const info = [
    { text: fillInsights(copy.infoPeriod, { start: formatDay(period.start, locale), end: formatDay(period.end, locale) }) },
    { text: fillInsights(copy.infoCoverage, { covered: metric.coverage, selected: metric.available, resources: copy.infoResourceChannels }) },
    ...(partial ? [{ text: copy.infoPartial }] : []),
    { text: fillInsights(copy.infoBasis, { basis: [metric.aggregationLabel, metric.aggregationNote].filter(Boolean).join(' ') }) },
    { text: fillInsights(copy.infoSource, { source: metric.sourceLabel }) },
    ...(latest ? [{ text: fillInsights(copy.infoLatest, { date: latest }) }] : []),
    ...(synced ? [{ text: fillInsights(copy.infoSynced, { date: synced }) }] : []),
    { text: copy.infoMissing },
    ...(comparisonNote(comparison, copy) ? [{ text: comparisonNote(comparison, copy)! }] : []),
  ];
  return {
    id, label,
    value: metric.displayTotal ?? (metric.total === null ? '' : formatMetricValue(metric.total, metric.unit, locale)),
    ...(metric.total === null && !metric.displayTotal ? { unavailable: copy.tileUnavailable } : {}),
    delta: deltaOf(metric, comparison, locale, copy),
    sparkline: metric.points.map(point => Number.isFinite(point.value) ? point.value : null),
    info, partial,
  };
}

/** The Audience tile: the sum of the latest valid audience of every selected channel, with covered versus selected. */
export function audienceTile(id: string, label: string, audience: AnalyticsSnapshot['audience'], context: Context): InsightsTile {
  const { copy, locale } = context;
  const partial = audience.covered < audience.selected;
  const newest = audience.entries.reduce<Date | null>((latest, entry) => (!latest || entry.asOf > latest ? entry.asOf : latest), null);
  const asOf = dateText(newest, locale);
  return {
    id, label,
    value: audience.covered ? new Intl.NumberFormat(locale).format(audience.total) : '',
    ...(audience.covered ? {} : { unavailable: copy.tileUnavailable }),
    info: [
      { text: copy.infoAudienceLatest },
      { text: fillInsights(copy.infoCoverage, { covered: audience.covered, selected: audience.selected, resources: copy.infoResourceChannels }) },
      ...(partial ? [{ text: copy.infoPartial }] : []),
      ...(asOf ? [{ text: fillInsights(copy.infoLatest, { date: asOf }) }] : []),
      { text: copy.infoAudienceOverlap },
      { text: copy.infoMissing },
    ],
    partial,
  };
}

/** A pinned metric appended after the headline tiles. */
export function pinnedTile(pin: PinnedMetricView, context: Context): InsightsTile {
  const { copy, locale } = context;
  const unavailable = pin.state !== 'available' || (pin.total === null && !pin.displayTotal);
  const partial = pin.coverage !== null && pin.available !== null && pin.coverage < pin.available;
  return {
    id: `pin:${pin.key}`, label: pin.label,
    value: pin.displayTotal ?? (pin.total === null ? '' : formatMetricValue(pin.total, pin.unit, locale)),
    ...(unavailable ? { unavailable: copy.tileUnavailable } : {}),
    delta: pin.comparison ? deltaOf(pin, pin.comparison, locale, copy) : undefined,
    info: [
      ...(pin.sourceLabel ? [{ text: fillInsights(copy.infoSource, { source: pin.sourceLabel }) }] : []),
      ...(pin.available !== null ? [{ text: fillInsights(copy.infoCoverage, { covered: pin.coverage ?? 0, selected: pin.available, resources: copy.infoResourceChannels }) }] : []),
      ...(pin.aggregationLabel ? [{ text: fillInsights(copy.infoBasis, { basis: pin.aggregationLabel }) }] : []),
      { text: copy.infoMissing },
    ],
    partial,
  };
}

/** Headline tiles from the Root policy, in policy order. A tile with no matching stored metric is left out rather than shown as zero. */
export function headlineTiles(snapshot: Pick<AnalyticsSnapshot, 'allMetrics' | 'comparisons' | 'audience'>, policy: InsightsPolicy, context: Context): { tiles: InsightsTile[]; metrics: Array<{ key: string }> } {
  const tiles: InsightsTile[] = [];
  const used: Array<{ key: string }> = [];
  for (const definition of policy.tiles) {
    const label = definition.label[context.locale];
    if (definition.source === 'audience') { tiles.push(audienceTile(definition.id, label, snapshot.audience, context)); continue; }
    const metric = pickMetric(snapshot.allMetrics, definition.words);
    if (!metric) continue;
    used.push({ key: metric.key });
    tiles.push(metricTile(definition.id, label, metric, snapshot.comparisons[metric.key], context));
  }
  return { tiles, metrics: used };
}

/** Metrics offered by the chart switcher: the headline metrics first, then the metrics with the longest series. Breakdowns and ad accounts are excluded. */
export function chartMetrics(snapshot: Pick<AnalyticsSnapshot, 'allMetrics' | 'previousPoints' | 'comparisons'>, headline: ReadonlyArray<{ key: string }>, policy: InsightsPolicy, context: Context & { exploreHref: (key: string) => string }): ChartMetric[] {
  const plottable = snapshot.allMetrics.filter(metric => metric.resourceKind === 'channel' && metric.kind !== 'breakdown' && metric.points.length > 1);
  const first = headline.map(item => plottable.find(metric => metric.key === item.key)).filter((metric): metric is MetricView => Boolean(metric));
  const rest = plottable.filter(metric => !first.includes(metric)).sort((a, b) => b.points.length - a.points.length);
  return [...first, ...rest].slice(0, policy.chartMetricsMax).map(metric => {
    const tile = metricTile(metric.key, metric.label, metric, snapshot.comparisons[metric.key], context);
    return {
      key: metric.key, label: metric.label, unit: metric.unit,
      points: metric.points.map(point => ({ date: point.date, value: Number.isFinite(point.value) ? point.value : null })),
      previous: snapshot.previousPoints[metric.key]?.map(point => ({ date: point.date, value: point.value })),
      info: tile.info, partial: tile.partial, exploreHref: context.exploreHref(metric.key),
    };
  });
}

/** Top posts: rank the recent measured posts by the first measure whose label contains a policy word; recency is the fallback. */
export function rankPosts<T extends { publishedAt: Date | null; measures: Array<{ key: string; label: string; value: number | null }> }>(posts: readonly T[], words: readonly string[], rows: number): { posts: T[]; measureKey: string | null; measureLabel: string | null } {
  let key: string | null = null;
  let label: string | null = null;
  for (const word of words) {
    const needle = word.toLowerCase();
    const hit = posts.flatMap(post => post.measures).find(measure => typeof measure.value === 'number' && measure.label.toLowerCase().includes(needle));
    if (hit) { key = hit.key; label = hit.label; break; }
  }
  const valueOf = (post: T) => key === null ? null : post.measures.find(measure => measure.key === key)?.value ?? null;
  const ranked = key === null ? [...posts] : [...posts].sort((a, b) => (valueOf(b) ?? -Infinity) - (valueOf(a) ?? -Infinity));
  return { posts: ranked.slice(0, rows), measureKey: key, measureLabel: label };
}
