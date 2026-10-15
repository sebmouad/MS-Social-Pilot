import { facebookAdMetricUnit, facebookMetricLabel, facebookPageMetricKind } from '@/platforms/facebook/analytics';
import { instagramMetricKind, instagramMetricLabel } from '@/platforms/instagram/analytics';
import { aggregateValues, genericMetricLabel, safeNumber, type AnalyticsMetric } from './catalog';

type PageRow = { metric: string; period?: string; endTime: Date; fetchedAt?: Date; numeric: number | null; value: unknown; target: { id: string; name: string } };
type AdRow = { date: Date; spend: number; impressions: number; clicks: number; reach: number; cpc: number | null; cpm: number | null; cpp: number | null; ctr: number | null; frequency: number | null; actions: unknown; fields: unknown; fetchedAt: Date; adAccount: { id: string; name: string; currency: string | null } };
type AudienceRow = { metric: string; numeric: number | null; endTime: Date; fetchedAt: Date; target: { id: string; name: string } };
type InstagramRow = { metric: string; period: string; endTime: Date; fetchedAt: Date; numeric: number | null; value: unknown; account: { id: string; igUserId: string; username: string } };
type InstagramAudienceRow = { igUserId: string; followersCount: number | null; lastSyncedAt: Date | null; updatedAt?: Date };
type ChannelSeries = { label?: string; values: number[]; latest: Date; latestValue?: number };

export type MetricView = {
  key: string; label: string; source: 'page' | 'instagram' | 'ads'; unit: AnalyticsMetric['unit']; kind: AnalyticsMetric['kind'];
  total: number | null; displayTotal?: string; latestAt: Date | null; updatedAt?: Date | null; coverage: number; available: number;
  points: Array<{ date: string; label: string; value: number }>;
  rows: Array<{ label: string; value: number; asOf: Date | null }>;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const formatDay = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const asMap = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const metricLabel = (key: string, source: MetricView['source']) =>
  (source === 'page' || source === 'ads' ? facebookMetricLabel(key) : instagramMetricLabel(key)) ?? genericMetricLabel(key);

function pageValue(row: PageRow): number | null { return row.numeric ?? safeNumber(row.value); }

export function latestAudience(rows: AudienceRow[], selectedPageIds: string[]) {
  const byPage = new Map<string, AudienceRow[]>();
  for (const row of rows) { const group = byPage.get(row.target.id) ?? []; group.push(row); byPage.set(row.target.id, group); }
  const entries = selectedPageIds.flatMap(id => {
    const group = byPage.get(id) ?? [];
    group.sort((a, b) => b.endTime.getTime() - a.endTime.getTime() || Number(b.metric === 'page_follows') - Number(a.metric === 'page_follows') || b.fetchedAt.getTime() - a.fetchedAt.getTime());
    const row = group[0];
    return row && row.numeric !== null ? [{ id, name: row.target.name, value: row.numeric, asOf: row.endTime, fetchedAt: row.fetchedAt, metric: row.metric }] : [];
  });
  return { entries, total: entries.reduce((sum, row) => sum + row.value, 0), covered: entries.length, selected: selectedPageIds.length };
}

function metricSeries(key: string, source: 'page' | 'instagram' | 'ads', kind: AnalyticsMetric['kind'], unit: AnalyticsMetric['unit'], observations: Array<{ date: Date; label: string; value: number }>, channelValues: Map<string, ChannelSeries>, selectedCount: number): MetricView {
  const grouped = new Map<string, number[]>();
  for (const row of observations) { const day = isoDay(row.date); const values = grouped.get(day) ?? []; values.push(row.value); grouped.set(day, values); }
  const points = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, label: formatDay(date), value: values.reduce((sum, n) => sum + n, 0) }));
  const values = [...channelValues.values()];
  const total = kind === 'stock' ? values.reduce((sum, item) => sum + (item.latestValue ?? item.values.at(-1) ?? 0), 0) : aggregateValues(observations.map(row => row.value), kind);
  const latestAt = values.length ? new Date(Math.max(...values.map(item => item.latest.getTime()))) : null;
  const rows = [...channelValues].map(([key, item]) => ({ label: item.label ?? key, value: kind === 'stock' ? (item.latestValue ?? item.values.at(-1)!) : item.values.reduce((sum, value) => sum + value, 0), asOf: item.latest })).sort((a, b) => b.value - a.value);
  return { key, label: metricLabel(key, source), source, unit, kind, total, latestAt, coverage: rows.length, available: selectedCount, points, rows };
}

export function buildAnalytics(pageRows: PageRow[], adRows: AdRow[], audienceRows: AudienceRow[], selectedTargets: Array<{ id: string; type: string; name: string; providerId?: string }>, adAvailableCount = new Set(adRows.map(row => row.adAccount.id)).size, instagramRows: InstagramRow[] = [], instagramAudienceRows: InstagramAudienceRow[] = []) {
  const selectedPages = selectedTargets.filter(target => target.type === 'page');
  const pageAudience = latestAudience(audienceRows, selectedPages.map(channel => channel.id));
  const selectedInstagram = selectedTargets.filter(target => target.type === 'instagram');
  const selectedInstagramIds = new Set(selectedInstagram.map(target => target.providerId).filter((id): id is string => Boolean(id)));
  const instagramAudience = instagramAudienceRows.flatMap(row => {
    const target = selectedInstagram.find(candidate => candidate.providerId === row.igUserId);
    const observedAt = row.lastSyncedAt ?? row.updatedAt;
    return target && selectedInstagramIds.has(row.igUserId) && row.followersCount !== null && observedAt
      ? [{ id: target.id, name: target.name, value: row.followersCount, asOf: observedAt, fetchedAt: observedAt, metric: 'instagram_followers' }]
      : [];
  });
  const audienceEntries = [...pageAudience.entries, ...instagramAudience];
  const audience = { entries: audienceEntries, total: audienceEntries.reduce((sum, row) => sum + row.value, 0), covered: audienceEntries.length, selected: selectedPages.length + selectedInstagram.length };
  const metrics: MetricView[] = [];
  const pageGroups = new Map<string, PageRow[]>();
  for (const row of pageRows) { const seriesKey = `${row.metric}::${row.period ?? 'day'}`; const group = pageGroups.get(seriesKey) ?? []; group.push(row); pageGroups.set(seriesKey, group); }
  for (const [seriesKey, groupRows] of pageGroups) {
    const key = groupRows[0]!.metric;
    const period = groupRows[0]!.period ?? 'day';
    const kind = facebookPageMetricKind(key);
    const channelValues = new Map<string, ChannelSeries>();
    const observations: Array<{ date: Date; label: string; value: number }> = [];
    const breakdownLatest = new Map<string, PageRow>();
    for (const row of groupRows) {
      const numeric = pageValue(row);
      if (numeric !== null) {
        observations.push({ date: row.endTime, label: row.target.name, value: numeric });
        const item = channelValues.get(row.target.id) ?? { label: row.target.name, values: [], latest: row.endTime };
        item.values.push(numeric); if (item.latestValue === undefined || row.endTime >= item.latest) { item.latest = row.endTime; item.latestValue = numeric; } channelValues.set(row.target.id, item);
      } else if (asMap(row.value) && Object.keys(asMap(row.value)).length) {
        const previous = breakdownLatest.get(row.target.id);
        if (!previous || row.endTime > previous.endTime) breakdownLatest.set(row.target.id, row);
      }
    }
    if (observations.length) {
      const metric = metricSeries(key, 'page', kind, 'count', observations, channelValues, selectedPages.length);
      const fetchedAt = groupRows.flatMap(row => row.fetchedAt ? [row.fetchedAt.getTime()] : []);
      metric.key = seriesKey; metric.updatedAt = fetchedAt.length ? new Date(Math.max(...fetchedAt)) : null; if (period !== 'day') metric.label = `${metric.label} · ${period}`; metrics.push(metric);
    }
    else if (breakdownLatest.size) {
      const sums = new Map<string, number>();
      for (const row of breakdownLatest.values()) for (const [label, value] of Object.entries(asMap(row.value))) { const n = safeNumber(value); if (n !== null) sums.set(label, (sums.get(label) ?? 0) + n); }
      const latestRows = [...breakdownLatest.values()];
      const fetchedAt = latestRows.flatMap(row => row.fetchedAt ? [row.fetchedAt.getTime()] : []);
      metrics.push({ key: seriesKey, label: `${metricLabel(key, 'page')}${period !== 'day' ? ` · ${period}` : ''}`, source: 'page', unit: 'count', kind: 'breakdown', total: null, latestAt: new Date(Math.max(...latestRows.map(row => row.endTime.getTime()))), updatedAt: fetchedAt.length ? new Date(Math.max(...fetchedAt)) : null, coverage: breakdownLatest.size, available: selectedPages.length, points: [], rows: [...sums].map(([label, value]) => ({ label, value, asOf: null })).sort((a, b) => b.value - a.value) });
    }
  }

  const instagramGroups = new Map<string, InstagramRow[]>();
  for (const row of instagramRows) {
    const target = selectedInstagram.find(candidate => candidate.providerId === row.account.igUserId);
    if (!target) continue;
    const seriesKey = `${row.metric}::${row.period}`;
    const group = instagramGroups.get(seriesKey) ?? [];
    group.push(row);
    instagramGroups.set(seriesKey, group);
  }
  const selectedInstagramCount = selectedInstagram.length;
  for (const [seriesKey, groupRows] of instagramGroups) {
    const key = groupRows[0]!.metric;
    const period = groupRows[0]!.period;
    const kind = instagramMetricKind(key);
    const channelValues = new Map<string, ChannelSeries>();
    const observations: Array<{ date: Date; label: string; value: number }> = [];
    const breakdownLatest = new Map<string, InstagramRow>();
    for (const row of groupRows) {
      const target = selectedInstagram.find(candidate => candidate.providerId === row.account.igUserId)!;
      const name = target.name || `@${row.account.username}`;
      const numeric = row.numeric ?? safeNumber(row.value);
      if (numeric !== null) {
        observations.push({ date: row.endTime, label: name, value: numeric });
        const item = channelValues.get(target.id) ?? { label: name, values: [], latest: row.endTime };
        item.values.push(numeric);
        if (row.endTime >= item.latest) { item.latest = row.endTime; item.latestValue = numeric; }
        channelValues.set(target.id, item);
      } else if (kind === 'breakdown' && Object.keys(asMap(row.value)).length) {
        const previous = breakdownLatest.get(target.id);
        if (!previous || row.endTime > previous.endTime) breakdownLatest.set(target.id, row);
      }
    }
    if (observations.length) {
      const metric = metricSeries(key, 'instagram', kind, 'count', observations, channelValues, selectedInstagramCount);
      const fetchedAt = groupRows.map(row => row.fetchedAt.getTime());
      metric.key = seriesKey;
      metric.updatedAt = fetchedAt.length ? new Date(Math.max(...fetchedAt)) : null;
      if (period !== 'day') metric.label = `${metric.label} · ${period}`;
      metrics.push(metric);
    } else if (breakdownLatest.size) {
      const sums = new Map<string, number>();
      for (const row of breakdownLatest.values()) for (const [label, value] of Object.entries(asMap(row.value))) {
        const n = safeNumber(value);
        if (n !== null) sums.set(label, (sums.get(label) ?? 0) + n);
      }
      const latestRows = [...breakdownLatest.values()];
      metrics.push({ key: seriesKey, label: `${metricLabel(key, 'instagram')}${period !== 'day' ? ` · ${period}` : ''}`, source: 'instagram', unit: 'count', kind: 'breakdown', total: null, latestAt: new Date(Math.max(...latestRows.map(row => row.endTime.getTime()))), updatedAt: new Date(Math.max(...latestRows.map(row => row.fetchedAt.getTime()))), coverage: breakdownLatest.size, available: selectedInstagramCount, points: [], rows: [...sums].map(([label, value]) => ({ label, value, asOf: null })).sort((a, b) => b.value - a.value) });
    }
  }

  const adFields = ['spend', 'impressions', 'clicks', 'reach'] as const;
  for (const key of adFields) {
    const channelValues = new Map<string, ChannelSeries>();
    const observations = adRows.map(row => { const label = key === 'spend' && row.adAccount.currency ? `${row.adAccount.name} · ${row.adAccount.currency}` : row.adAccount.name; const item = channelValues.get(row.adAccount.id) ?? { label, values: [], latest: row.date }; item.values.push(row[key]); if (row.date >= item.latest) { item.latest = row.date; item.latestValue = row[key]; } channelValues.set(row.adAccount.id, item); return { date: row.date, label, value: row[key] }; });
    if (observations.length) {
      const metric = metricSeries(key, 'ads', key === 'reach' ? 'stock' : 'flow', key === 'spend' ? 'currency' : 'count', observations, channelValues, adAvailableCount);
      metric.updatedAt = new Date(Math.max(...adRows.map(row => row.fetchedAt.getTime())));
      const currencies = new Set(adRows.map(row => row.adAccount.currency).filter(Boolean));
      if (key === 'spend' && currencies.size > 1) { metric.total = null; metric.displayTotal = 'Multiple currencies'; }
      metrics.push(metric);
    }
  }
  const byDay = new Map<string, AdRow[]>();
  for (const row of adRows) { const day = isoDay(row.date); const group = byDay.get(day) ?? []; group.push(row); byDay.set(day, group); }
  const weighted = (rows: AdRow[], field: 'cpc' | 'cpm' | 'cpp' | 'ctr' | 'frequency', weight: 'clicks' | 'impressions' | 'reach') => {
    const available = rows.filter(row => row[field] !== null && row[weight] > 0);
    const denominator = available.reduce((sum, row) => sum + row[weight], 0);
    return denominator ? available.reduce((sum, row) => sum + row[field]! * row[weight], 0) / denominator : null;
  };
  const adDerived: Record<string, (rows: AdRow[]) => number | null> = {
    cpc: rows => weighted(rows, 'cpc', 'clicks') ?? (() => { const clicks = rows.reduce((sum, row) => sum + row.clicks, 0); return clicks ? rows.reduce((sum, row) => sum + row.spend, 0) / clicks : null; })(),
    cpm: rows => weighted(rows, 'cpm', 'impressions') ?? (() => { const impressions = rows.reduce((sum, row) => sum + row.impressions, 0); return impressions ? rows.reduce((sum, row) => sum + row.spend, 0) / impressions * 1000 : null; })(),
    ctr: rows => weighted(rows, 'ctr', 'impressions') ?? (() => { const impressions = rows.reduce((sum, row) => sum + row.impressions, 0); return impressions ? rows.reduce((sum, row) => sum + row.clicks, 0) / impressions * 100 : null; })(),
    cpp: rows => weighted(rows, 'cpp', 'reach') ?? (() => { const reach = rows.reduce((sum, row) => sum + row.reach, 0); return reach ? rows.reduce((sum, row) => sum + row.spend, 0) / reach : null; })(),
    frequency: rows => weighted(rows, 'frequency', 'reach') ?? (() => { const reach = rows.reduce((sum, row) => sum + row.reach, 0); return reach ? rows.reduce((sum, row) => sum + row.impressions, 0) / reach : null; })(),
  };
  for (const [key, calculate] of Object.entries(adDerived)) {
    if (!adRows.length) continue;
    const observations = [...byDay].map(([date, rows]) => ({ date: new Date(`${date}T00:00:00Z`), label: '', value: calculate(rows) })).filter((row): row is { date: Date; label: string; value: number } => row.value !== null);
    const channels = new Map<string, ChannelSeries>();
    for (const row of observations) { const item = channels.get('Selected ad accounts') ?? { values: [], latest: row.date }; item.values.push(row.value); if (row.date > item.latest) item.latest = row.date; channels.set('Selected ad accounts', item); }
    const from = Math.min(...adRows.map(row => row.date.getTime()));
    const selectedRangeRows = adRows.filter(row => row.date.getTime() >= from);
    const latestDay = [...byDay.keys()].sort().at(-1)!;
    const total = ['cpp', 'frequency'].includes(key) ? calculate(byDay.get(latestDay) ?? []) : calculate(selectedRangeRows);
    const accountGroups = new Map<string, AdRow[]>();
    for (const row of adRows) { const group = accountGroups.get(row.adAccount.id) ?? []; group.push(row); accountGroups.set(row.adAccount.id, group); }
    const rows = [...accountGroups.values()].flatMap(group => {
      const latestAccountDay = isoDay(group.reduce((latest, row) => row.date > latest ? row.date : latest, group[0]!.date));
      const accountValue = ['cpp', 'frequency'].includes(key) ? calculate(group.filter(row => isoDay(row.date) === latestAccountDay)) : calculate(group);
      return accountValue === null ? [] : [{ label: group[0]!.adAccount.name, value: accountValue, asOf: new Date(group.reduce((latest, row) => row.date > latest ? row.date : latest, group[0]!.date).getTime()) }];
    });
    const unit = facebookAdMetricUnit(key, adRows[0]?.adAccount.currency);
    const currencies = new Set(adRows.map(row => row.adAccount.currency).filter(Boolean));
    metrics.push({ key, label: metricLabel(key, 'ads'), source: 'ads', kind: 'ratio', unit, total: currencies.size > 1 && unit === 'currency' ? null : total, ...(currencies.size > 1 && unit === 'currency' ? { displayTotal: 'Multiple currencies' } : {}), latestAt: new Date(Math.max(...adRows.map(row => row.date.getTime()))), updatedAt: new Date(Math.max(...adRows.map(row => row.fetchedAt.getTime()))), coverage: rows.length, available: adAvailableCount, points: observations.map(row => ({ date: isoDay(row.date), label: formatDay(isoDay(row.date)), value: row.value })), rows });
  }

  // Discover numeric fields retained in the JSON payload as well as typed columns.
  const extras = new Map<string, Array<{ date: Date; label: string; value: number }>>();
  const addExtra = (key: string, row: AdRow, value: unknown) => {
    if (['spend','impressions','clicks','reach','cpc','cpm','cpp','ctr','frequency'].includes(key)) return;
    const numeric = safeNumber(value);
    if (numeric === null) return;
    const points = extras.get(key) ?? []; points.push({ date: row.date, label: row.adAccount.name, value: numeric }); extras.set(key, points);
  };
  for (const row of adRows) {
    for (const [key, value] of Object.entries(asMap(row.fields))) {
      if (Array.isArray(value)) for (const item of value) {
        const record = asMap(item); if (typeof record.action_type === 'string') addExtra(`${key}:${record.action_type}`, row, record.value);
      } else addExtra(key, row, value);
    }
    const actionGroups = Array.isArray(row.actions) ? [['actions', row.actions] as const] : Object.entries(asMap(row.actions));
    for (const [key, value] of actionGroups) {
      if (!Array.isArray(value)) continue;
      for (const item of value) { const record = asMap(item); if (typeof record.action_type === 'string') addExtra(`${key}:${record.action_type}`, row, record.value); }
    }
  }
  for (const [key, observations] of extras) {
    const channelValues = new Map<string, ChannelSeries>();
    for (const row of observations) { const item = channelValues.get(row.label) ?? { values: [], latest: row.date }; item.values.push(row.value); if (row.date > item.latest) item.latest = row.date; channelValues.set(row.label, item); }
    if (observations.length) { const metric = metricSeries(key, 'ads', 'flow', 'count', observations, channelValues, adAvailableCount); metric.updatedAt = new Date(Math.max(...adRows.map(row => row.fetchedAt.getTime()))); metrics.push(metric); }
  }

  return { audience, metrics: metrics.sort((a, b) => (a.source === b.source ? a.label.localeCompare(b.label) : a.source.localeCompare(b.source))) };
}
