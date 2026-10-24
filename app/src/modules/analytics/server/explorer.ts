import { localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { analyticsError } from '@/modules/analytics/server/error-copy';
import { ANALYTICS_EXPLORER_CONFIG } from '../explorer-config';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { readAnalyticsSnapshot } from './read';
import type { AnalyticsReadActor, AnalyticsReadConstraints } from './types';
import { parseAnalyticsExplorerInput, type AnalyticsExplorerInput, type AnalyticsExplorerMetricData, type AnalyticsExplorerResult } from '../explorer';

type Actor = AnalyticsReadActor;
function pageSlice<T>(items: T[], requested: number | undefined, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size)); const current = Math.min(requested ?? 1, pages); const offset = (current - 1) * size;
  return { items: items.slice(offset, offset + size), total: items.length, page: current, pages, pageSize: size };
}
function canonical(query: string, input: AnalyticsExplorerInput, pages: { page: number; pointPage?: number; rowPage?: number }) {
  const params = new URLSearchParams(query);
  if (input.source) params.set('source', input.source); else params.delete('source');
  if (input.kind && input.kind !== 'all') params.set('kind', input.kind); else params.delete('kind');
  if (input.search) params.set('search', input.search); else params.delete('search');
  if (input.metric) params.set('metric', input.metric); else params.delete('metric');
  if (input.page !== undefined) params.set('page', String(pages.page)); else params.delete('page');
  if (input.pointPage !== undefined && pages.pointPage !== undefined) params.set('pointPage', String(pages.pointPage)); else params.delete('pointPage');
  if (input.rowPage !== undefined && pages.rowPage !== undefined) params.set('rowPage', String(pages.rowPage)); else params.delete('rowPage');
  return params.toString();
}
function metricView(metric: Awaited<ReturnType<typeof readAnalyticsSnapshot>>['allMetrics'][number]): AnalyticsExplorerMetricData {
  return { key: metric.key, label: metric.label, sourceLabel: metric.sourceLabel, kind: metric.kind, unit: metric.unit, total: metric.total, ...(metric.displayTotal ? { displayTotal: metric.displayTotal } : {}), aggregationLabel: metric.aggregationLabel, ...(metric.aggregationNote ? { aggregationNote: metric.aggregationNote } : {}), coverage: metric.coverage, available: metric.available, latestAt: metric.latestAt, points: metric.points, rows: metric.rows };
}

// React memoization is request-scoped; entry-point authorization remains in the shared reader.
const explorerLimits = cache(async () => {
  const keys = [...new Set([...ANALYTICS_EXPLORER_CONFIG.map(definition => definition.key), 'analytics.searchMaxLength', 'analytics.detailPageSize'])];
  const settings = new Map(await Promise.all(keys.map(async key => [key, await runtimeConfig(key)] as const)));
  for (const definition of ANALYTICS_EXPLORER_CONFIG) {
    if (!definition.schema.safeParse(settings.get(definition.key)).success) throw await analyticsError('unavailable', "Analytics Explorer settings are unavailable.");
  }
  return ['analytics.explorerSearchMaxCharacters', 'analytics.searchMaxLength', 'analytics.explorerPageSize', 'analytics.detailPageSize'].map(key => Number(settings.get(key)));
});

export async function readAnalyticsExplorer(actor: Actor, rawInput: unknown = {}, constraints: AnalyticsReadConstraints = {}, responseCap?: number): Promise<AnalyticsExplorerResult> {
  try {
  const [explorerSearchLimit, readerSearchLimit, pageSize, detailSize] = await explorerLimits();
  if ([explorerSearchLimit, readerSearchLimit, pageSize, detailSize].some(value => !Number.isSafeInteger(value) || value < 1)) throw await analyticsError('unavailable', "Analytics Explorer settings are unavailable.");
  if (responseCap !== undefined && (!Number.isSafeInteger(responseCap) || responseCap < 1)) throw await analyticsError('invalid_request', "Choose a valid Analytics result limit.");
  const searchLimit = Math.min(explorerSearchLimit, readerSearchLimit);
  const boundedPageSize = responseCap === undefined ? pageSize : Math.min(pageSize, Math.max(1, Math.trunc(responseCap)));
  const boundedDetailSize = responseCap === undefined ? detailSize : Math.min(detailSize, Math.max(1, Math.trunc(responseCap)));
  const input = parseAnalyticsExplorerInput(rawInput, searchLimit);
  const { source, kind, page: requestedPage, pointPage, rowPage, ...readInput } = input;
  // The established Analytics reader owns tenant, resource, provider and date validation.
  const snapshot = await readAnalyticsSnapshot(actor, readInput, { ...constraints, feature: 'analytics/explorer' });
  const filtered = snapshot.allMetrics.filter(metric => (!source || metric.sourceLabel === source) && (!kind || kind === 'all' || metric.kind === kind));
  const page = pageSlice(filtered.map(metricView).map(({ points: _points, rows: _rows, ...summary }) => summary), requestedPage, boundedPageSize);
  const selected = input.metric ? filtered.find(metric => metric.key === input.metric) : undefined;
  const detail = selected ? (() => {
    const metric = metricView(selected);
    const { points, rows, ...summary } = metric;
    return { metric: summary, ...(snapshot.previousPoints?.[selected.key]?.length ? { previousPoints: snapshot.previousPoints[selected.key] } : {}), points: pageSlice(points, pointPage, boundedDetailSize), rows: pageSlice(rows, rowPage, boundedDetailSize) };
  })() : null;
  const options = {
    channels: snapshot.options.channels.map(({ id, name }) => ({ id, name })),
    adAccounts: snapshot.options.adAccounts,
    sources: [...new Set(snapshot.options.metrics.map(metric => metric.sourceLabel))].sort((a, b) => a.localeCompare(b)),
    metrics: [...page.items.map(({ key, label, sourceLabel }) => ({ key, label, sourceLabel })), ...(selected && !page.items.some(metric => metric.key === selected.key) ? [{ key: selected.key, label: selected.label, sourceLabel: selected.sourceLabel }] : [])],
  };
  return {
    period: { start: snapshot.period.start, end: snapshot.period.end, comparison: snapshot.period.comparison ? { mode: snapshot.period.comparison.mode, start: snapshot.period.comparison.start, end: snapshot.period.comparison.end } : null },
    options, selected: snapshot.selected,
    filters: { search: input.search ?? '', source: source ?? '', kind: kind ?? 'all' },
    searchMaxCharacters: searchLimit,
    metrics: page,
    detail,
    query: canonical(snapshot.query, input, { page: page.page, pointPage: detail?.points.page, rowPage: detail?.rows.page }),
  };

  } catch (error) { throw await localizeAnalyticsError(error); }
}
