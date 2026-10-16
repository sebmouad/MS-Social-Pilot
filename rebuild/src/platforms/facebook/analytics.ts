import { prisma } from '@/server/data';
import type { AnalyticsAdAccount, AnalyticsAudienceEntry, AnalyticsKind, AnalyticsMetricInput, AnalyticsObservation, AnalyticsProviderData, AnalyticsProviderRequest, AnalyticsTarget } from '@/server/analytics/catalog';
import { safeNumber } from '@/server/analytics/catalog';

/** Provider vocabulary and interpretation for stored Facebook Page and Meta Ads metrics. */
const metricNames: Record<string, string> = {
  page_follows: 'Followers', page_fans: 'Page likes',
  page_daily_follows: 'Daily follows', page_daily_follows_unique: 'New followers',
  page_daily_unfollows_unique: 'Lost followers', page_total_media_view_unique: 'People reached',
  page_impressions_unique: 'Unique impressions', page_impressions: 'Impressions',
  page_media_view: 'Media views', page_post_engagements: 'Post engagements',
  page_views_total: 'Page views', page_video_views: 'Video views',
  spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks', reach: 'Reach',
  cpc: 'Cost per click', cpm: 'Cost per 1,000 impressions', cpp: 'Cost per person reached',
  ctr: 'Click-through rate', frequency: 'Frequency',
};

export function facebookMetricLabel(key: string): string | undefined {
  return metricNames[key];
}

function facebookLabel(key: string): string {
  return facebookMetricLabel(key) ?? key.replace(/^page_/, '').replace(/[:_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function facebookPageMetricKind(key: string): AnalyticsKind {
  if (['page_follows', 'page_fans', 'page_fans_online_per_day', 'page_daily_follows_unique', 'page_daily_unfollows_unique', 'page_total_media_view_unique', 'page_impressions_unique'].includes(key)) return 'stock';
  if (/country|city|locale|gender_age|source/.test(key)) return 'breakdown';
  return ['page_daily_follows', 'page_impressions', 'page_media_view', 'page_post_engagements', 'page_views_total', 'page_video_views'].includes(key) ? 'flow' : 'stock';
}

export function facebookAdMetricUnit(key: string, _currency?: string | null): AnalyticsMetricInput['unit'] {
  if (key === 'spend' || ['cpc', 'cpm', 'cpp', 'action_values'].includes(key) || /(^|:)(cost_per|cost_per_unique|action_values)/.test(key)) return 'currency';
  if (key === 'ctr') return 'percent';
  if (key === 'frequency') return 'multiple';
  return 'count';
}

type PageRow = { metric: string; period: string | null; endTime: Date; fetchedAt: Date; numeric: number | null; value: unknown; target: { id: string; name: string } };
type AdRow = { date: Date; spend: number; impressions: number; clicks: number; reach: number; cpc: number | null; cpm: number | null; cpp: number | null; ctr: number | null; frequency: number | null; actions: unknown; fields: unknown; fetchedAt: Date; adAccount: { id: string; name: string; currency: string | null } };
type FacebookTarget = AnalyticsTarget & { socialAccountId: string | null };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const overlappingPeopleNote = 'Counts may overlap across resources. Sums are not deduplicated people or total reach for the whole period.';

function pageInputs(rows: PageRow[], selected: FacebookTarget[], audienceRows: PageRow[], audienceAsOf?: Date): { metrics: AnalyticsMetricInput[]; audience: AnalyticsAudienceEntry[] } {
  const groups = new Map<string, PageRow[]>();
  for (const row of rows) { const key = `${row.metric}::${row.period ?? 'day'}`; const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  const metrics: AnalyticsMetricInput[] = [];
  for (const [key, group] of groups) {
    const first = group[0]!; const kind = facebookPageMetricKind(first.metric); const period = first.period ?? 'day';
    const numeric = group.flatMap(row => { const value = row.numeric ?? safeNumber(row.value); return value === null ? [] : [{ date: row.endTime, channelId: row.target.id, channelLabel: row.target.name, value }]; });
    const coveredResourceIds = [...new Set(numeric.map(row => row.channelId))].sort();
    const updatedAt = new Date(Math.max(...group.map(row => row.fetchedAt.getTime())));
    const baseLabel = `${facebookLabel(first.metric)}${period !== 'day' ? ` · ${period}` : ''}`;
    if (numeric.length) metrics.push({ key, label: kind === 'stock' ? `${baseLabel} · Latest per channel` : baseLabel, sourceLabel: 'Page performance', kind, unit: 'count', observations: numeric, ...(/unique|reach/.test(first.metric) ? { aggregationNote: overlappingPeopleNote } : {}), coveredResourceIds, ...(kind === 'stock' || period !== 'day' ? { rollup: 'latest-per-channel' as const } : {}), available: selected.length, updatedAt });
    const newest = new Map<string, PageRow>();
    for (const row of group) { if (!Object.keys(object(row.value)).length) continue; const old = newest.get(row.target.id); if (!old || old.endTime < row.endTime || (old.endTime.getTime() === row.endTime.getTime() && row.fetchedAt > old.fetchedAt)) newest.set(row.target.id, row); }
    const values = new Map<string, number>();
    for (const row of newest.values()) for (const [label, raw] of Object.entries(object(row.value))) { const value = safeNumber(raw); if (value !== null) values.set(label, (values.get(label) ?? 0) + value); }
    const latest = [...newest.values()];
    if (values.size) metrics.push({ key: numeric.length ? `${key}::breakdown` : key, label: `${baseLabel} · Categories`, sourceLabel: 'Page performance', kind: 'breakdown', unit: 'count', observations: [], rows: [...values].map(([label, value]) => ({ label, value, asOf: null })), coveredResourceIds: [...newest.keys()].sort(), available: selected.length, covered: newest.size, latestAt: latest.length ? new Date(Math.max(...latest.map(row => row.endTime.getTime()))) : null, updatedAt: latest.length ? new Date(Math.max(...latest.map(row => row.fetchedAt.getTime()))) : null });
  }
  const newest = new Map<string, PageRow>();
  for (const row of audienceRows) { if (audienceAsOf && row.endTime > audienceAsOf) continue; const old = newest.get(row.target.id); if (!old || row.endTime > old.endTime || (row.endTime.getTime() === old.endTime.getTime() && row.metric === 'page_follows' && old.metric !== 'page_follows') || (row.endTime.getTime() === old.endTime.getTime() && row.metric === old.metric && row.fetchedAt > old.fetchedAt)) newest.set(row.target.id, row); }
  const audience = [...newest.values()].flatMap(row => row.numeric === null ? [] : [{ id: row.target.id, name: row.target.name, metric: row.metric, metricLabel: row.metric === 'page_fans' ? 'Page likes' : 'Followers', sourceLabel: 'Page performance', value: row.numeric, asOf: row.endTime, fetchedAt: row.fetchedAt }]);
  return { metrics, audience };
}

type SelectedAdAccount = AnalyticsAdAccount;
type ExtraValue = { observation: AnalyticsObservation; sourcePriority: number };

function adInputs(rows: AdRow[], selectedAdAccounts: SelectedAdAccount[]): AnalyticsMetricInput[] {
  const metrics: AnalyticsMetricInput[] = [];
  const byCurrency = new Map<string, AdRow[]>();
  for (const row of rows) { const currency = row.adAccount.currency ?? ''; const group = byCurrency.get(currency) ?? []; group.push(row); byCurrency.set(currency, group); }
  const availableForCurrency = (currency: string) => selectedAdAccounts.filter(account => (account.currency ?? '') === currency).length;
  const currencyKey = (key: string, currency: string, unit: AnalyticsMetricInput['unit']) => unit === 'currency' ? `${key}::${currency || 'unknown-currency'}` : key;
  const currencyLabel = (key: string, currency: string, unit: AnalyticsMetricInput['unit']) => `${facebookMetricLabel(key) ?? facebookLabel(key)}${unit === 'currency' ? ` · ${currency || 'Unknown currency'}` : ''}`;
  const latestSync = (source: AdRow[]) => source.length ? new Date(Math.max(...source.map(row => row.fetchedAt.getTime()))) : null;
  const extraUnit = (key: string, currency: string): AnalyticsMetricInput['unit'] => {
    const known = facebookAdMetricUnit(key, currency || null);
    return known === 'currency' || /value|cost|spend|amount|revenue|income/i.test(key) ? 'currency' : known;
  };

  // Delivery counts can be combined across ad accounts; monetary spend is split into currency series.
  for (const key of ['impressions', 'clicks', 'reach'] as const) {
    const observations = rows.map(row => ({ date: row.date, channelId: row.adAccount.id, channelLabel: row.adAccount.name, value: row[key] }));
    if (observations.length) metrics.push({ key, label: key === 'reach' ? 'Reach · Latest per ad account' : facebookMetricLabel(key)!, sourceLabel: 'Advertising', kind: key === 'reach' ? 'stock' : 'flow', unit: 'count', observations, ...(key === 'reach' ? { aggregationNote: overlappingPeopleNote } : {}), coveredResourceIds: [...new Set(observations.map(row => row.channelId))].sort(), available: selectedAdAccounts.length, updatedAt: latestSync(rows) });
  }
  for (const [currency, currencyRows] of byCurrency) {
    const available = availableForCurrency(currency);
    if (!currencyRows.length) continue;
    const unit = 'currency';
    const observations = currencyRows.map(row => ({ date: row.date, channelId: row.adAccount.id, channelLabel: row.adAccount.name, value: row.spend }));
    metrics.push({ key: currencyKey('spend', currency, unit), label: currencyLabel('spend', currency, unit), sourceLabel: 'Advertising', kind: 'flow', unit, observations, coveredResourceIds: [...new Set(observations.map(row => row.channelId))].sort(), available, updatedAt: latestSync(currencyRows) });
  }

  const byDay = (source: AdRow[]) => {
    const groups = new Map<string, AdRow[]>();
    for (const row of source) { const day = dayKey(row.date); const group = groups.get(day) ?? []; group.push(row); groups.set(day, group); }
    return groups;
  };
  const sum = (source: AdRow[], key: 'spend' | 'clicks' | 'impressions' | 'reach') => source.reduce((total, row) => total + row[key], 0);
  const ratio = (key: string, source: AdRow[]): number | null => {
    const spend = sum(source, 'spend');
    if (key === 'cpc') { const clicks = sum(source, 'clicks'); return clicks ? spend / clicks : null; }
    if (key === 'cpm') { const impressions = sum(source, 'impressions'); return impressions ? spend / impressions * 1000 : null; }
    if (key === 'ctr') { const impressions = sum(source, 'impressions'); return impressions ? sum(source, 'clicks') / impressions * 100 : null; }
    if (key === 'cpp') { const reach = sum(source, 'reach'); return reach ? spend / reach : null; }
    if (key === 'frequency') { const reach = sum(source, 'reach'); return reach ? sum(source, 'impressions') / reach : null; }
    return null;
  };
  for (const key of ['cpc', 'cpm', 'cpp', 'ctr', 'frequency']) {
    const groups = ['cpc', 'cpm', 'cpp'].includes(key) ? [...byCurrency] : [['', rows] as [string, AdRow[]]];
    for (const [currency, currencyRows] of groups) {
      const available = currency ? availableForCurrency(currency) : selectedAdAccounts.length;
      const daily = [...byDay(currencyRows)].flatMap(([day, group]) => { const value = ratio(key, group); return value === null ? [] : [{ date: new Date(`${day}T00:00:00Z`), value }]; });
      const accounts = new Map<string, AdRow[]>();
      for (const row of currencyRows) { const group = accounts.get(row.adAccount.id) ?? []; group.push(row); accounts.set(row.adAccount.id, group); }
      const detailsByAccount = [...accounts.entries()].flatMap(([id, group]) => {
        const latest = group.reduce((a, b) => a.date > b.date ? a : b).date;
        const eligible = ['cpp', 'frequency'].includes(key) ? group.filter(row => dayKey(row.date) === dayKey(latest)) : group;
        const value = ratio(key, eligible);
        return value === null ? [] : [{ id, label: `${group[0]!.adAccount.name}${currency ? ` · ${currency}` : ''}`, value, asOf: latest }];
      });
      const details = detailsByAccount.map(({ id: _id, ...detail }) => detail);
      const totalRows = ['cpp', 'frequency'].includes(key) && daily.length ? currencyRows.filter(row => dayKey(row.date) === dayKey(daily.at(-1)!.date)) : currencyRows;
      const total = ratio(key, totalRows);
      const totalObservations = total === null || !daily.length ? [] : [{ date: daily.at(-1)!.date, value: total }];
      if (!currencyRows.length) continue;
      const unit = facebookAdMetricUnit(key, currency || null);
      const latestDayOnly = ['cpp', 'frequency'].includes(key);
      const coveredResourceIds = latestDayOnly ? [...new Set(totalRows.filter(row => row.reach > 0).map(row => row.adAccount.id))].sort() : detailsByAccount.map(item => item.id).sort();
      metrics.push({ key: currencyKey(key, currency, unit), label: currencyLabel(key, currency, unit), ...(latestDayOnly ? { aggregationLabel: 'Calculated for the latest stored day', aggregationNote: 'Calculated using summed account reach for the latest stored day. People may overlap across accounts; this is not a deduplicated rate for the whole period.' } : {}), sourceLabel: 'Advertising', kind: 'ratio', unit, observations: daily.map(item => ({ ...item, channelId: 'total', channelLabel: 'Selected ad accounts' })), totalObservations, rows: details, coveredResourceIds, available, covered: coveredResourceIds.length, updatedAt: latestSync(currencyRows) });
    }
  }

  const extras = new Map<string, Map<string, ExtraValue>>();
  const breakdowns = new Map<string, Map<string, { label: string; date: Date; fetchedAt: Date; sourcePriority: number; values: Map<string, number> }>>();
  const add = (key: string, row: AdRow, raw: unknown, sourcePriority: number, knownAction: boolean) => {
    if (['spend','impressions','clicks','reach','cpc','cpm','cpp','ctr','frequency'].includes(key)) return;
    const value = safeNumber(raw); if (value === null) return;
    const observation = { date: row.date, channelId: row.adAccount.id, channelLabel: row.adAccount.name, value };
    const identity = `${row.adAccount.id}::${dayKey(row.date)}`;
    const values = extras.get(key) ?? new Map<string, ExtraValue>();
    const old = values.get(identity);
    if (!old || sourcePriority > old.sourcePriority) values.set(identity, { observation, sourcePriority });
    extras.set(key, values);
    if (knownAction) knownActions.add(key);
  };
  // Field-level payload copies are priority 0; the dedicated actions payload wins when both contain the same key.
  const knownActions = new Set<string>();
  const addBreakdown = (key: string, row: AdRow, categories: Array<[string, unknown]>, sourcePriority: number) => {
    const values = categories.flatMap(([label, raw]) => { const value = safeNumber(raw); return value === null ? [] : [[label, value] as [string, number]]; });
    if (!values.length) return;
    const accounts = breakdowns.get(key) ?? new Map(); const previous = accounts.get(row.adAccount.id);
    if (!previous || row.date > previous.date || (row.date.getTime() === previous.date.getTime() && sourcePriority > previous.sourcePriority)) accounts.set(row.adAccount.id, { label: row.adAccount.name, date: row.date, fetchedAt: row.fetchedAt, sourcePriority, values: new Map(values) });
    breakdowns.set(key, accounts);
  };
  const readField = (key: string, row: AdRow, raw: unknown, sourcePriority: number, knownAction = false) => {
    if (Array.isArray(raw)) {
      const categories: Array<[string, unknown]> = [];
      raw.forEach((entry, index) => {
        const item = object(entry);
        if (typeof item.action_type === 'string') add(`${key}:${item.action_type}`, row, item.value, sourcePriority, true);
        else if (Object.keys(item).length) {
          const category = ['label', 'category', 'name', 'title', 'age', 'country', 'gender'].find(field => typeof item[field] === 'string');
          if (category) categories.push([String(item[category]), item.value ?? item.total]);
          else if (Object.values(item).every(value => safeNumber(value) !== null)) categories.push(...Object.entries(item));
          else for (const [field, value] of Object.entries(item)) readField(`${key}:${field}`, row, value, sourcePriority, knownAction);
        } else if (safeNumber(entry) !== null) categories.push([String(index), entry]);
      });
      addBreakdown(key, row, categories, sourcePriority);
      return;
    }
    const record = object(raw);
    if (Object.keys(record).length) {
      if (typeof record.action_type === 'string') add(`${key}:${record.action_type}`, row, record.value, sourcePriority, true);
      else {
        const scalarValues = Object.entries(record).filter(([, value]) => safeNumber(value) !== null);
        if (scalarValues.length) addBreakdown(key, row, scalarValues, sourcePriority);
        for (const [field, value] of Object.entries(record)) if (safeNumber(value) === null) readField(`${key}:${field}`, row, value, sourcePriority, knownAction);
      }
      return;
    }
    add(key, row, raw, sourcePriority, knownAction);
  };
  for (const row of rows) {
    for (const [key, raw] of Object.entries(object(row.fields))) readField(key, row, raw, 0);
    if (Array.isArray(row.actions)) readField('actions', row, row.actions, 1);
    else for (const [key, raw] of Object.entries(object(row.actions))) readField(key, row, raw, 1);
  }
  for (const [key, indexed] of extras) {
    const observations = [...indexed.values()].map(item => item.observation);
    const currencies = new Map<string, AnalyticsObservation[]>();
    for (const observation of observations) {
      const source = rows.find(row => row.adAccount.id === observation.channelId);
      const currency = source?.adAccount.currency ?? '';
      const seriesCurrency = extraUnit(key, currency) === 'currency' ? currency : '';
      const group = currencies.get(seriesCurrency) ?? []; group.push(observation); currencies.set(seriesCurrency, group);
    }
    for (const [currency, currencyObservations] of currencies) {
      const unit = extraUnit(key, currency);
      const monetary = unit === 'currency';
      const actionValue = /(^|:)action_values(?::|$)/.test(key);
      const costRatio = /(^|:)cost_per/.test(key);
      const kind: AnalyticsKind = actionValue || (knownActions.has(key) && !costRatio) ? 'flow' : costRatio ? 'ratio' : 'stock';
      const available = monetary ? availableForCurrency(currency) : selectedAdAccounts.length;
      const accountRows = kind === 'flow' ? undefined : currencyObservations.map(item => ({ label: `${item.channelLabel}${currency ? ` · ${currency}` : ''} · ${dayKey(item.date)}`, value: item.value, asOf: item.date }));
      metrics.push({ key: currencyKey(key, currency, unit), label: kind === 'stock' ? `${currencyLabel(key, currency, unit)} · Latest per ad account` : currencyLabel(key, currency, unit), sourceLabel: 'Advertising', kind, unit, observations: currencyObservations, ...(accountRows ? { rows: accountRows, covered: new Set(currencyObservations.map(item => item.channelId)).size, totalOverride: null, displayTotal: costRatio ? 'Per-account values' : 'Stored values' } : {}), ...(kind === 'stock' ? { rollup: 'latest-per-channel' as const } : {}), coveredResourceIds: [...new Set(currencyObservations.map(item => item.channelId))].sort(), available, updatedAt: latestSync(rows.filter(row => currencyObservations.some(item => item.channelId === row.adAccount.id))) });
    }
  }
  for (const [key, accounts] of breakdowns) {
    const values = new Map<string, number>();
    for (const account of accounts.values()) for (const [label, value] of account.values) values.set(label, (values.get(label) ?? 0) + value);
    const latest = [...accounts.values()];
    if (values.size) metrics.push({ key: extras.has(key) ? `${key}::breakdown` : key, label: `${facebookLabel(key)} · Categories`, sourceLabel: 'Advertising', kind: 'breakdown', unit: 'count', observations: [], rows: [...values].map(([label, value]) => ({ label, value, asOf: null })), coveredResourceIds: [...accounts.keys()].sort(), available: selectedAdAccounts.length, covered: accounts.size, latestAt: new Date(Math.max(...latest.map(item => item.date.getTime()))), updatedAt: new Date(Math.max(...latest.map(item => item.fetchedAt.getTime()))) });
  }
  return metrics.map(metric => ({ ...metric, resourceKind: 'ad-account' }));
}

/** Pure mapper kept at the Facebook boundary so stored-row semantics can be tested without storage. */
export function normalizeFacebookAnalytics(input: { pageRows: PageRow[]; audienceRows: PageRow[]; adRows: AdRow[]; selectedTargets: FacebookTarget[]; selectedAdAccounts: SelectedAdAccount[]; audienceAsOf?: Date }) {
  const page = pageInputs(input.pageRows, input.selectedTargets, input.audienceRows, input.audienceAsOf);
  return { metrics: [...page.metrics, ...adInputs(input.adRows, input.selectedAdAccounts)], audienceEntries: page.audience, audienceSelected: input.selectedTargets.length };
}

/** Facebook-only adapter from the legacy Page and Ads tables to provider-neutral analytics inputs. */
export const facebookAnalyticsHost = {
  async load(request: AnalyticsProviderRequest): Promise<AnalyticsProviderData> {
    const allowed = request.allowedTargetIds === undefined ? undefined : [...request.allowedTargetIds];
    const targets = await prisma.target.findMany({
      where: { workspaceId: request.workspaceId, enabled: true, type: 'page', socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } },
      orderBy: { name: 'asc' }, select: { id: true, name: true, type: true, providerId: true, socialAccountId: true },
    }) as FacebookTarget[];
    const visible = targets.filter(target => allowed === undefined || allowed.includes(target.id));
    const selectedTargets = visible.filter(target => request.selectedTargetIds.includes(target.id));
    const targetIds = selectedTargets.map(target => target.id);
    const socialAccountIds = [...new Set(visible.map(target => target.socialAccountId).filter((id): id is string => Boolean(id)))];
    const adAccounts = request.allowedTargetIds === undefined
      ? await prisma.adAccount.findMany({ where: { workspaceId: request.workspaceId, enabled: true, socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } })
      : socialAccountIds.length
        ? await prisma.adAccount.findMany({ where: { workspaceId: request.workspaceId, socialAccountId: { in: socialAccountIds }, enabled: true, socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } })
        : [];
    const selectedAdAccountIds = request.selectedAdAccountIds === undefined ? adAccounts.map(item => item.id) : adAccounts.filter(item => request.selectedAdAccountIds!.includes(item.id)).map(item => item.id);
    const [pageRows, audienceRows, adRows] = await Promise.all([
      prisma.pageInsight.findMany({ where: { targetId: { in: targetIds }, target: { workspaceId: request.workspaceId, type: 'page', socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, endTime: { gte: request.range.from, lte: request.range.to } }, orderBy: [{ endTime: 'asc' }, { metric: 'asc' }], select: { metric: true, period: true, endTime: true, numeric: true, value: true, fetchedAt: true, target: { select: { id: true, name: true } } } }),
      prisma.pageInsight.findMany({ where: { targetId: { in: targetIds }, target: { workspaceId: request.workspaceId, type: 'page', socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, metric: { in: ['page_follows', 'page_fans'] }, numeric: { not: null }, endTime: { lte: request.range.to } }, orderBy: [{ endTime: 'desc' }, { fetchedAt: 'desc' }], select: { metric: true, period: true, endTime: true, numeric: true, value: true, fetchedAt: true, target: { select: { id: true, name: true } } } }),
      selectedAdAccountIds.length ? prisma.adInsight.findMany({ where: { adAccount: { workspaceId: request.workspaceId, id: { in: selectedAdAccountIds }, ...(allowed === undefined ? {} : { socialAccountId: { in: socialAccountIds } }), enabled: true, socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, level: 'account', date: { gte: request.range.from, lte: request.range.to } }, orderBy: [{ date: 'asc' }], select: { date: true, spend: true, impressions: true, clicks: true, reach: true, cpc: true, cpm: true, cpp: true, ctr: true, frequency: true, actions: true, fields: true, fetchedAt: true, adAccount: { select: { id: true, name: true, currency: true } } } }) : Promise.resolve([]),
    ]);
    const selectedAdAccounts = adAccounts.filter(account => selectedAdAccountIds.includes(account.id));
    const normalized = normalizeFacebookAnalytics({ pageRows: pageRows as PageRow[], selectedTargets, audienceRows: audienceRows as PageRow[], adRows: adRows as AdRow[], selectedAdAccounts, audienceAsOf: request.range.to });
    return { targets: visible.map(({ socialAccountId: _socialAccountId, ...target }) => target), selectedTargets: selectedTargets.map(({ socialAccountId: _socialAccountId, ...target }) => target), adAccounts, selectedAdAccountIds, ...normalized };
  },
};
