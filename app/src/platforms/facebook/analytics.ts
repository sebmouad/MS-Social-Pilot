const FACEBOOK_PLATFORM_ID = 'facebook'; // installed platform id (module.ts), not the Page's remote id

import { analyticsLanguage } from '@/modules/analytics/server/error-copy';
import { runtimeConfigBatch } from '@/server/config/store';
import { FACEBOOK_METRIC_LABEL_DEFAULTS, FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS } from './config';
import { facebookInsightCategories } from './data-normalization';
import { facebookAudienceGrowthIdentity } from './audience-growth';
import { prisma } from '@/server/data';
import { Prisma } from '../../../generated/client';
import { readFacebookPostPerformance } from './post-performance';
import { readFacebookGoalMeasures } from './goals';
import { readFacebookDestinationMeasures } from './destination-measures';
import { hasUnrolledDayBreakdowns } from './rollups';
import { readChannelRollupPreference, type ChannelRollupPreference } from '@/modules/analytics/rollups/read';
import type { AnalyticsAdAccount, AnalyticsAudienceEntry, AnalyticsKind, AnalyticsMetricInput, AnalyticsObservation, AnalyticsProviderData, AnalyticsProviderRequest, AnalyticsTarget } from '@/modules/analytics/server/catalog';
import { safeNumber } from '@/modules/analytics/server/catalog';

/** Provider vocabulary and interpretation for stored Facebook Page and Meta Ads metrics. */
const metricNames: Record<string, string> = {
  spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks', reach: 'Reach',
  cpc: 'Cost per click', cpm: 'Cost per 1,000 impressions', cpp: 'Cost per person reached',
  ctr: 'Click-through rate', frequency: 'Frequency',
};

export function facebookMetricLabel(key: string): string | undefined {
  return metricNames[key] ?? (FACEBOOK_METRIC_LABEL_DEFAULTS as Record<string, { en: string; fr: string }>)[key]?.en;
}

const sentence = (text: string) => text.replace(/[._]+/g, ' ').trim().replace(/^\w/, c => c.toUpperCase());

type LabelCatalog = Record<string, { en: string; fr: string }>;

/**
 * Readable name for a stored key: an Ads action (`actions:onsite_conversion.post_net_like`,
 * `cost_per_action_type:link_click`) or a plain field. Catalog entries (shipped, then Root-saved)
 * win; action types use `action:<type>` entries; unknown types fall back to a sentence-cased name.
 */
export function facebookAdLabel(key: string, catalog: LabelCatalog = FACEBOOK_METRIC_LABEL_DEFAULTS, locale: 'en' | 'fr' = 'en'): string {
  const known = (name: string) => catalog[name]?.[locale] ?? (locale === 'en' ? metricNames[name] : undefined);
  const exact = known(key);
  if (exact) return exact;
  const cut = key.indexOf(':');
  if (cut > 0) {
    const head = key.slice(0, cut), tail = key.slice(cut + 1);
    const action = tail.split(':').map(part => known(`action:${part}`) ?? known(part) ?? sentence(part.replace(/^(onsite_conversion|offsite_conversion)\./, ''))).join(' · ');
    const prefix = head === 'actions' ? undefined : known(head) ?? sentence(head);
    return prefix ? `${action} · ${prefix}` : action;
  }
  return sentence(key.replace(/^page_/, ''));
}

function facebookLabel(key: string): string {
  return facebookAdLabel(key);
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

/** Identity, naming and date-window fields of an insights payload; they describe the row and are never measures, even when numeric-looking. */
export function facebookIdentifierField(key: string): boolean {
  return /(^|:)([a-z0-9]+_)*(id|ids|name|currency|start|stop)$/i.test(key) || /(^|:)(date_start|date_stop|objective|account_id)$/.test(key);
}

type PageRow = { metric: string; period: string | null; endTime: Date; fetchedAt: Date; numeric: number | null; value: unknown; target: { id: string; name: string } };
type AdRow = { date: Date; spend: number; impressions: number; clicks: number; reach: number; cpc: number | null; cpm: number | null; cpp: number | null; ctr: number | null; frequency: number | null; actions: unknown; fields: unknown; fetchedAt: Date; adAccount: { id: string; name: string; currency: string | null } };
type FacebookTarget = AnalyticsTarget & { socialAccountId: string | null };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
/** Root can override these presentation entries in the existing extensible meta.metricLabels catalog. */
export const FACEBOOK_AD_ANALYTICS_COPY_DEFAULTS = {
  "ads.source": {
    "en": "Advertising",
    "fr": "Publicité"
  },
  "ads.latest": {
    "en": "Latest per ad account",
    "fr": "Dernière valeur par compte publicitaire"
  },
  "ads.latestDay": {
    "en": "Calculated for the latest stored day",
    "fr": "Calculé pour le dernier jour enregistré"
  },
  "ads.latestDayNote": {
    "en": "Calculated using summed account reach for the latest stored day. People may overlap across accounts; this is not a deduplicated rate for the whole period.",
    "fr": "Calculé avec la somme des portées des comptes pour le dernier jour enregistré. Une personne peut figurer dans plusieurs comptes ; ce taux ne représente pas des personnes distinctes sur toute la période."
  },
  "ads.selectedAccounts": {
    "en": "Selected ad accounts",
    "fr": "Comptes publicitaires sélectionnés"
  },
  "ads.perAccount": {
    "en": "Per-account values",
    "fr": "Valeurs par compte"
  },
  "ads.stored": {
    "en": "Stored values",
    "fr": "Valeurs enregistrées"
  },
  "ads.unknownCurrency": {
    "en": "Unknown currency",
    "fr": "Devise inconnue"
  }
};

type PagePresentation = { locale?: 'en' | 'fr'; metricLabels?: Record<string, { en: string; fr: string }>; pageCopy?: Record<'en' | 'fr', Omit<(typeof FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS)['en'], 'postSeries' | 'postSeriesNote' | 'rollupWeeksNote'> & { postSeries?: string; postSeriesNote?: string; rollupWeeksNote?: string }>; weeklySeriesNote?: boolean };

function pageInputs(rows: PageRow[], selected: FacebookTarget[], audienceRows: PageRow[], audienceAsOf?: Date, presentation: PagePresentation = {}): { metrics: AnalyticsMetricInput[]; audience: AnalyticsAudienceEntry[] } {
  const locale = presentation.locale ?? 'en';
  const copy = (presentation.pageCopy ?? FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS)[locale];
  const labels = { ...FACEBOOK_METRIC_LABEL_DEFAULTS, ...presentation.metricLabels } as Record<string, { en: string; fr: string }>;
  const label = (key: string) => labels[key]?.[locale] ?? facebookMetricLabel(key) ?? key.replace(/^page_/, '').replace(/[:_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const groups = new Map<string, PageRow[]>();
  for (const row of rows) { const key = `${row.metric}::${row.period ?? 'day'}`; const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  const metrics: AnalyticsMetricInput[] = [];
  for (const [key, group] of groups) {
    const first = group[0]!; const kind = facebookPageMetricKind(first.metric); const period = first.period ?? 'day';
    const numeric = group.flatMap(row => { const value = row.numeric ?? safeNumber(row.value); return value === null ? [] : [{ date: row.endTime, channelId: row.target.id, channelLabel: row.target.name, value }]; });
    const coveredResourceIds = [...new Set(numeric.map(row => row.channelId))].sort();
    const updatedAt = new Date(Math.max(...group.map(row => row.fetchedAt.getTime())));
    const periodName: Record<string, { en: string; fr: string }> = { week: { en: 'last 7 days', fr: '7 derniers jours' }, days_28: { en: 'last 28 days', fr: '28 derniers jours' }, lifetime: { en: 'lifetime', fr: 'depuis la création' } };
    const baseLabel = `${label(first.metric)}${period !== 'day' ? ` · ${periodName[period]?.[locale] ?? period}` : ''}`;
    // Saved catalogs predate the weekly note and keep working: fall back to the shipped default until Root re-saves.
    const weeklyNote = copy.rollupWeeksNote ?? FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS[locale].rollupWeeksNote;
    const seriesNotes = [/unique|reach/.test(first.metric) ? copy.overlap : undefined, period === 'day' && presentation.weeklySeriesNote ? weeklyNote : undefined].filter((note): note is string => Boolean(note));
    if (numeric.length) metrics.push({ key, label: kind === 'stock' ? `${baseLabel} · ${copy.latest}` : baseLabel, sourceLabel: copy.source, kind, unit: 'count', observations: numeric, ...(seriesNotes.length ? { aggregationNote: seriesNotes.join(' ') } : {}), coveredResourceIds, ...(kind === 'stock' || period !== 'day' ? { rollup: 'latest-per-channel' as const } : {}), available: selected.length, updatedAt });
    // Keep each stored resource/time snapshot. Re-fetches at the same time
    // select the newest fetch; categories absent from a snapshot stay absent.
    const historyRows = new Map<string, PageRow>();
    for (const row of group) {
      if (!row.value || typeof row.value !== 'object') continue;
      const identity = JSON.stringify([row.target.id, row.endTime.toISOString()]);
      const previous = historyRows.get(identity);
      if (!previous || row.fetchedAt > previous.fetchedAt) historyRows.set(identity, row);
    }
    const breakdownHistory = [...historyRows.values()]
      .sort((a, b) => a.endTime.getTime() - b.endTime.getTime() || a.target.id.localeCompare(b.target.id))
      .map(row => ({ resourceId: row.target.id, resourceLabel: row.target.name, asOf: row.endTime, fetchedAt: row.fetchedAt,
        rows: facebookInsightCategories(row.value) }));
    const newest = new Map<string, PageRow>();
    for (const row of group) { if (!row.value || typeof row.value !== 'object' || !Object.keys(row.value).length) continue; const old = newest.get(row.target.id); if (!old || old.endTime < row.endTime || (old.endTime.getTime() === row.endTime.getTime() && row.fetchedAt > old.fetchedAt)) newest.set(row.target.id, row); }
    const values = new Map<string, number>();
    for (const row of newest.values()) for (const { label, value } of facebookInsightCategories(row.value)) { if (value !== null) values.set(label, (values.get(label) ?? 0) + value); }
    const latest = [...newest.values()];
    if (breakdownHistory.length) metrics.push({ ...(first.metric.startsWith('content:') ? { totalOverride: null } : {}), breakdownHistory, key: numeric.length ? `${key}::breakdown` : key, label: `${baseLabel} · ${copy.categories}`, sourceLabel: copy.source, kind: 'breakdown', unit: 'count', observations: [], rows: [...values].map(([label, value]) => ({ label, value, asOf: null })), coveredResourceIds: [...newest.keys()].sort(), available: selected.length, covered: newest.size, latestAt: latest.length ? new Date(Math.max(...latest.map(row => row.endTime.getTime()))) : null, updatedAt: latest.length ? new Date(Math.max(...latest.map(row => row.fetchedAt.getTime()))) : null });
  }
  const newest = new Map<string, PageRow>();
  for (const row of audienceRows) { if (audienceAsOf && row.endTime > audienceAsOf) continue; const old = newest.get(row.target.id); if (!old || row.endTime > old.endTime || (row.endTime.getTime() === old.endTime.getTime() && row.metric === 'page_follows' && old.metric !== 'page_follows') || (row.endTime.getTime() === old.endTime.getTime() && row.metric === old.metric && row.fetchedAt > old.fetchedAt)) newest.set(row.target.id, row); }
  const audience = [...newest.values()].flatMap(row => row.numeric === null ? [] : [{ id: row.target.id, name: row.target.name, metric: row.metric, metricLabel: label(row.metric), sourceLabel: copy.source, value: row.numeric, asOf: row.endTime, fetchedAt: row.fetchedAt }]);
  return { metrics: metrics.map(metric => {
    const audienceGrowth = facebookAudienceGrowthIdentity(metric.key.split('::')[0]!);
    return audienceGrowth && metric.kind !== 'breakdown' ? { ...metric, audienceGrowth } : metric;
  }), audience };
}

type PostRow = { createdTime: Date; insights: unknown; insightsSyncedAt: Date | null; target: { id: string; name: string } };

/**
 * Page-level series built from synced post insights, for Pages whose own Page insights are missing or sparse.
 * A post's insight is a lifetime total as of its last sync, so each value is attributed to the day the post was
 * published ("posts published that day"), never to the day the views happened. Posts without a stored value
 * stay unknown. Non-additive measures (people reached/viewed) carry the overlap note.
 */
function postInputs(rows: PostRow[], selected: FacebookTarget[], presentation: PagePresentation = {}): AnalyticsMetricInput[] {
  const locale = presentation.locale ?? 'en';
  const copy = { ...FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS[locale], ...(presentation.pageCopy?.[locale] ?? {}) };
  const labels = { ...FACEBOOK_METRIC_LABEL_DEFAULTS, ...presentation.metricLabels } as LabelCatalog;
  const series = new Map<string, { observations: AnalyticsObservation[]; syncedAt: Date }>();
  for (const row of rows) {
    const insights = object(row.insights);
    for (const [key, raw] of Object.entries(insights)) {
      const value = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
      if (value === null || facebookIdentifierField(key)) continue;
      const entry = series.get(key) ?? { observations: [], syncedAt: new Date(0) };
      entry.observations.push({ date: new Date(`${dayKey(row.createdTime)}T00:00:00Z`), channelId: row.target.id, channelLabel: row.target.name, value });
      if (row.insightsSyncedAt && row.insightsSyncedAt > entry.syncedAt) entry.syncedAt = row.insightsSyncedAt;
      series.set(key, entry);
    }
  }
  return [...series].map(([key, { observations, syncedAt }]) => {
    const covered = [...new Set(observations.map(item => item.channelId))].sort();
    const overlapping = /unique|reach/.test(key);
    return {
      key: `post:${key}`, label: `${labels[key]?.[locale] ?? facebookAdLabel(key, labels, locale)} · ${copy.postSeries}`, sourceLabel: copy.source, kind: 'flow', unit: 'count', observations,
      aggregationNote: overlapping ? `${copy.postSeriesNote} ${copy.overlap}` : copy.postSeriesNote,
      coveredResourceIds: covered, available: selected.length, covered: covered.length, updatedAt: syncedAt, latestAt: new Date(Math.max(...observations.map(item => item.date.getTime()))),
    } satisfies AnalyticsMetricInput;
  });
}

type SelectedAdAccount = AnalyticsAdAccount;
type ExtraValue = { observation: AnalyticsObservation; sourcePriority: number };

function adInputs(rows: AdRow[], selectedAdAccounts: SelectedAdAccount[], presentation: PagePresentation = {}): AnalyticsMetricInput[] {
  const locale = presentation.locale ?? 'en';
  const adCatalog = { ...FACEBOOK_METRIC_LABEL_DEFAULTS, ...FACEBOOK_AD_ANALYTICS_COPY_DEFAULTS, ...presentation.metricLabels } as LabelCatalog;
  const text = (key: keyof typeof FACEBOOK_AD_ANALYTICS_COPY_DEFAULTS) => adCatalog[key]![locale];
  const pageCopy = { ...FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS[locale], ...presentation.pageCopy?.[locale] };
  const facebookLabel = (key: string) => facebookAdLabel(key, adCatalog, presentation.locale ?? 'en');
  const facebookMetricLabel = facebookLabel;
  const metrics: AnalyticsMetricInput[] = [];
  const byCurrency = new Map<string, AdRow[]>();
  for (const row of rows) { const currency = row.adAccount.currency ?? ''; const group = byCurrency.get(currency) ?? []; group.push(row); byCurrency.set(currency, group); }
  const availableForCurrency = (currency: string) => selectedAdAccounts.filter(account => (account.currency ?? '') === currency).length;
  const currencyKey = (key: string, currency: string, unit: AnalyticsMetricInput['unit']) => unit === 'currency' ? `${key}::${currency || 'unknown-currency'}` : key;
  const currencyLabel = (key: string, currency: string, unit: AnalyticsMetricInput['unit']) => `${facebookLabel(key)}${unit === 'currency' ? ` · ${currency || text('ads.unknownCurrency')}` : ''}`;
  const latestSync = (source: AdRow[]) => source.length ? new Date(Math.max(...source.map(row => row.fetchedAt.getTime()))) : null;
  const extraUnit = (key: string, currency: string): AnalyticsMetricInput['unit'] => {
    const known = facebookAdMetricUnit(key, currency || null);
    return known === 'currency' || /value|cost|spend|amount|revenue|income/i.test(key) ? 'currency' : known;
  };

  // Delivery counts can be combined across ad accounts; monetary spend is split into currency series.
  for (const key of ['impressions', 'clicks', 'reach'] as const) {
    const observations = rows.map(row => ({ date: row.date, channelId: row.adAccount.id, channelLabel: row.adAccount.name, value: row[key] }));
    if (observations.length) metrics.push({ key, label: key === 'reach' ? `${facebookMetricLabel(key)} · ${text('ads.latest')}` : facebookMetricLabel(key)!, sourceLabel: text('ads.source'), kind: key === 'reach' ? 'stock' : 'flow', unit: 'count', observations, ...(key === 'reach' ? { aggregationNote: pageCopy.overlap } : {}), coveredResourceIds: [...new Set(observations.map(row => row.channelId))].sort(), available: selectedAdAccounts.length, updatedAt: latestSync(rows) });
  }
  for (const [currency, currencyRows] of byCurrency) {
    const available = availableForCurrency(currency);
    if (!currencyRows.length) continue;
    const unit = 'currency';
    const observations = currencyRows.map(row => ({ date: row.date, channelId: row.adAccount.id, channelLabel: row.adAccount.name, value: row.spend }));
    metrics.push({ key: currencyKey('spend', currency, unit), label: currencyLabel('spend', currency, unit), sourceLabel: text('ads.source'), kind: 'flow', unit, observations, coveredResourceIds: [...new Set(observations.map(row => row.channelId))].sort(), available, updatedAt: latestSync(currencyRows) });
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
      metrics.push({ key: currencyKey(key, currency, unit), label: currencyLabel(key, currency, unit), ...(latestDayOnly ? { aggregationLabel: text('ads.latestDay'), aggregationNote: text('ads.latestDayNote') } : {}), sourceLabel: text('ads.source'), kind: 'ratio', unit, observations: daily.map(item => ({ ...item, channelId: 'total', channelLabel: text('ads.selectedAccounts') })), totalObservations, rows: details, coveredResourceIds, available, covered: coveredResourceIds.length, updatedAt: latestSync(currencyRows) });
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
    if (facebookIdentifierField(key)) return;
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
    for (const [key, raw] of Object.entries(object(row.fields))) if (key !== 'delivery_breakdowns') readField(key, row, raw, 0);
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
      metrics.push({ key: currencyKey(key, currency, unit), label: kind === 'stock' ? `${currencyLabel(key, currency, unit)} · ${text('ads.latest')}` : currencyLabel(key, currency, unit), sourceLabel: text('ads.source'), kind, unit, observations: currencyObservations, ...(accountRows ? { rows: accountRows, covered: new Set(currencyObservations.map(item => item.channelId)).size, totalOverride: null, displayTotal: costRatio ? text('ads.perAccount') : text('ads.stored') } : {}), ...(kind === 'stock' ? { rollup: 'latest-per-channel' as const } : {}), coveredResourceIds: [...new Set(currencyObservations.map(item => item.channelId))].sort(), available, updatedAt: latestSync(rows.filter(row => currencyObservations.some(item => item.channelId === row.adAccount.id))) });
    }
  }
  for (const [key, accounts] of breakdowns) {
    const values = new Map<string, number>();
    for (const account of accounts.values()) for (const [label, value] of account.values) values.set(label, (values.get(label) ?? 0) + value);
    const latest = [...accounts.values()];
    if (values.size) metrics.push({ key: extras.has(key) ? `${key}::breakdown` : key, label: `${facebookLabel(key)} · ${pageCopy.categories}`, sourceLabel: text('ads.source'), kind: 'breakdown', unit: 'count', observations: [], rows: [...values].map(([label, value]) => ({ label, value, asOf: null })), coveredResourceIds: [...accounts.keys()].sort(), available: selectedAdAccounts.length, covered: accounts.size, latestAt: new Date(Math.max(...latest.map(item => item.date.getTime()))), updatedAt: new Date(Math.max(...latest.map(item => item.fetchedAt.getTime()))) });
  }
  return [...metrics, ...deliveryBreakdownInputs(rows, selectedAdAccounts, facebookLabel, text('ads.source'), pageCopy.overlap)].map(metric => ({ ...metric, resourceKind: 'ad-account' }));
}

/** Delivery dimensions retain daily/account/currency identity and never enter account totals. */
function deliveryBreakdownInputs(rows: AdRow[], selected: SelectedAdAccount[], facebookLabel: (key: string) => string, sourceLabel: string, overlap: string): AnalyticsMetricInput[] {
  const groups = new Map<string, { field: string; currency: string; history: NonNullable<AnalyticsMetricInput['breakdownHistory']> }>();
  for (const row of rows) {
    const payload = object(row.fields).delivery_breakdowns;
    if (!Array.isArray(payload)) continue;
    for (const raw of payload) {
      const dataset = object(raw);
      if (!Array.isArray(dataset.dimensions) || !dataset.dimensions.every(value => typeof value === 'string') || !Array.isArray(dataset.rows)) continue;
      const dimensions = dataset.dimensions as string[];
      const fields = new Map<string, Array<{ label: string; value: number | null }>>();
      for (const rawItem of dataset.rows) {
        const item = object(rawItem);
        const category = dimensions.map(key => `${key}: ${String(item[key] ?? '')}`).join(' · ');
        for (const [field, value] of Object.entries(item)) {
          if (dimensions.includes(field) || ['date_start', 'date_stop', 'account_id', 'account_name', 'account_currency'].includes(field)) continue;
          if (Array.isArray(value)) {
            for (const rawAction of value) {
              const action = object(rawAction);
              if (typeof action.action_type !== 'string') continue;
              const key = `${field}:${action.action_type}`;
              const values = fields.get(key) ?? []; values.push({ label: category, value: safeNumber(action.value) }); fields.set(key, values);
            }
          } else {
            const number = safeNumber(value);
            if (number === null) continue;
            const values = fields.get(field) ?? []; values.push({ label: category, value: number }); fields.set(field, values);
          }
        }
      }
      for (const [field, values] of fields) {
        const currency = facebookAdMetricUnit(field) === 'currency' ? row.adAccount.currency ?? '' : '';
        const key = JSON.stringify([dimensions, field, currency]);
        const group = groups.get(key) ?? { field, currency, history: [] };
        group.history.push({ resourceId: row.adAccount.id, resourceLabel: row.adAccount.name, asOf: row.date, fetchedAt: row.fetchedAt, rows: values }); groups.set(key, group);
      }
    }
  }
  return [...groups].map(([key, group]) => {
    const latest = new Map<string, (typeof group.history)[number]>();
    for (const snapshot of group.history) {
      const previous = latest.get(snapshot.resourceId);
      if (!previous || snapshot.asOf > previous.asOf || (snapshot.asOf.getTime() === previous.asOf.getTime() && snapshot.fetchedAt > previous.fetchedAt)) latest.set(snapshot.resourceId, snapshot);
    }
    return { key: `delivery:${key}`, label: `${facebookLabel(group.field)}${group.currency ? ` · ${group.currency}` : ''}`, sourceLabel, kind: 'breakdown', unit: facebookAdMetricUnit(group.field), observations: [],
      breakdownHistory: group.history, rows: [...latest.values()].flatMap(snapshot => snapshot.rows.flatMap(value => value.value === null ? [] : [{ label: `${snapshot.resourceLabel} · ${value.label}`, value: value.value, asOf: snapshot.asOf }])),
      available: selected.length, coveredResourceIds: [...latest.keys()], covered: latest.size, totalOverride: null, aggregationNote: overlap,
      updatedAt: new Date(Math.max(...group.history.map(snapshot => snapshot.fetchedAt.getTime()))), latestAt: new Date(Math.max(...group.history.map(snapshot => snapshot.asOf.getTime()))) };
  });
}

/** Pure mapper kept at the Facebook boundary so stored-row semantics can be tested without storage. */
export function normalizeFacebookAnalytics(input: { pageRows: PageRow[]; audienceRows: PageRow[]; adRows: AdRow[]; postRows?: PostRow[]; selectedTargets: FacebookTarget[]; selectedAdAccounts: SelectedAdAccount[]; audienceAsOf?: Date } & PagePresentation) {
  const page = pageInputs(input.pageRows, input.selectedTargets, input.audienceRows, input.audienceAsOf, input);
  return { metrics: [...page.metrics, ...postInputs(input.postRows ?? [], input.selectedTargets, input), ...adInputs(input.adRows, input.selectedAdAccounts, input)], audienceEntries: page.audience, audienceSelected: input.selectedTargets.length };
}

/**
 * Resolve the precomputed day-series for this read, if any. A weekly span with
 * unrolled breakdowns falls back to the daily cascade; anything else uncovered
 * reads in full detail. Never throws: rollups are a fast path, not a gate.
 */
async function resolveDayRollup(workspaceId: string, targetIds: string[], range: { from: Date; to: Date }): Promise<ChannelRollupPreference | null> {
  try {
    const preference = await readChannelRollupPreference({ provider: FACEBOOK_PLATFORM_ID, workspaceId, targetIds, from: range.from, to: range.to });
    if (!preference) return null;
    if (!await hasUnrolledDayBreakdowns({ workspaceId, targetIds, from: preference.rolledFrom, to: preference.rolledTo })) return preference;
    if (preference.granularity !== 'weekly') return null;
    const daily = await readChannelRollupPreference({ provider: FACEBOOK_PLATFORM_ID, workspaceId, targetIds, from: range.from, to: range.to, granularities: ['daily'] });
    if (!daily || daily.granularity !== 'daily') return null;
    return await hasUnrolledDayBreakdowns({ workspaceId, targetIds, from: daily.rolledFrom, to: daily.rolledTo }) ? null : daily;
  } catch {
    return null;
  }
}

/** Facebook-only adapter from the legacy Page and Ads tables to provider-neutral analytics inputs. */
export const facebookAnalyticsHost = {
  postPerformance: readFacebookPostPerformance,
  goalMeasures: readFacebookGoalMeasures,
  destinationMeasures: readFacebookDestinationMeasures,
  async load(request: AnalyticsProviderRequest): Promise<AnalyticsProviderData> {
    const allowed = request.allowedTargetIds === undefined ? undefined : [...request.allowedTargetIds];
    const targets = await prisma.target.findMany({
      where: { workspaceId: request.workspaceId, enabled: true, type: 'page', socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } },
      orderBy: { name: 'asc' }, select: { id: true, name: true, type: true, providerId: true, socialAccountId: true },
    }) as FacebookTarget[];
    const visible = targets.filter(target => allowed === undefined || allowed.includes(target.id));
    const selectedTargets = visible.filter(target => request.selectedTargetIds.includes(target.id));
    const targetIds = selectedTargets.map(target => target.id);
    // Ads authority is independent of the channel selection when the request names it; otherwise it follows the channel ceiling.
    const adTargetCeiling = 'allowedAdTargetIds' in request ? request.allowedAdTargetIds : request.allowedTargetIds;
    const adTargets = adTargetCeiling === undefined ? undefined : targets.filter(target => adTargetCeiling.includes(target.id));
    const socialAccountIds = [...new Set((adTargets ?? visible).map(target => target.socialAccountId).filter((id): id is string => Boolean(id)))];
    const accountCeiling = request.allowedAdAccountIds;
    const adAccounts = accountCeiling?.length === 0 ? []
      : adTargetCeiling === undefined
      ? await prisma.adAccount.findMany({ where: { workspaceId: request.workspaceId, enabled: true, ...(accountCeiling ? { id: { in: [...accountCeiling] } } : {}), socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } })
      : socialAccountIds.length
        ? await prisma.adAccount.findMany({ where: { workspaceId: request.workspaceId, socialAccountId: { in: socialAccountIds }, enabled: true, ...(accountCeiling ? { id: { in: [...accountCeiling] } } : {}), socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } })
        : [];
    const selectedAdAccountIds = request.selectedAdAccountIds === undefined ? adAccounts.map(item => item.id) : adAccounts.filter(item => request.selectedAdAccountIds!.includes(item.id)).map(item => item.id);
    // Precomputed day-series replace the detailed day rows they cover: complete
    // past days on the daily path (today still reads in detail), the whole range
    // on the weekly path. Non-day periods, audience, ads and post cohorts always
    // read in detail; anything uncovered falls back silently to full detail.
    const rollup = targetIds.length ? await resolveDayRollup(request.workspaceId, targetIds, request.range) : null;
    const targetNames = new Map(selectedTargets.map(target => [target.id, target.name]));
    const rollupDayRows: PageRow[] = (rollup?.rows ?? []).flatMap(row => {
      const name = targetNames.get(row.targetId);
      return name === undefined ? [] : [{ metric: row.metric, period: row.period, endTime: row.date, numeric: row.value, value: null, fetchedAt: row.fetchedAt, target: { id: row.targetId, name } }];
    });
    const dayComplement = !rollup ? {} : rollup.granularity === 'weekly'
      ? { period: { not: 'day' } }
      : { OR: [{ period: { not: 'day' } }, { endTime: { gt: rollup.rolledTo } }] };
    const [detailedPageRows, audienceRows, adRows] = await Promise.all([
      prisma.pageInsight.findMany({ where: { targetId: { in: targetIds }, target: { workspaceId: request.workspaceId, type: 'page', socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, endTime: { gte: request.range.from, lte: request.range.to }, ...dayComplement }, orderBy: [{ endTime: 'asc' }, { metric: 'asc' }], select: { metric: true, period: true, endTime: true, numeric: true, value: true, fetchedAt: true, target: { select: { id: true, name: true } } } }),
      prisma.pageInsight.findMany({ where: { targetId: { in: targetIds }, target: { workspaceId: request.workspaceId, type: 'page', socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, metric: { in: ['page_follows', 'page_fans'] }, numeric: { not: null }, endTime: { lte: request.range.to } }, orderBy: [{ endTime: 'desc' }, { fetchedAt: 'desc' }], select: { metric: true, period: true, endTime: true, numeric: true, value: true, fetchedAt: true, target: { select: { id: true, name: true } } } }),
      selectedAdAccountIds.length ? prisma.adInsight.findMany({ where: { adAccount: { workspaceId: request.workspaceId, id: { in: selectedAdAccountIds }, ...(adTargetCeiling === undefined ? {} : { socialAccountId: { in: socialAccountIds } }), enabled: true, socialAccount: { is: { workspaceId: request.workspaceId, provider: 'facebook', invalidatedAt: null } } }, level: 'account', date: { gte: request.range.from, lte: request.range.to } }, orderBy: [{ date: 'asc' }], select: { date: true, spend: true, impressions: true, clicks: true, reach: true, cpc: true, cpm: true, cpp: true, ctr: true, frequency: true, actions: true, fields: true, fetchedAt: true, adAccount: { select: { id: true, name: true, currency: true } } } }) : Promise.resolve([]),
    ]);
    const selectedAdAccounts = adAccounts.filter(account => selectedAdAccountIds.includes(account.id));
    const [presentation, locale] = await Promise.all([runtimeConfigBatch(['meta.metricLabels', 'meta.pageAnalyticsCopy', 'meta.postSeriesMaxPosts']), analyticsLanguage()]);
    // Synced post insights give a Page-level series when Page insights are missing or sparse; same workspace, selection and date bounds.
    const postRows = targetIds.length ? (await prisma.$queryRaw<Array<{ targetId: string; targetName: string; createdTime: Date; insights: unknown; insightsSyncedAt: Date }>>(Prisma.sql`
      SELECT ep."targetId", t.name AS "targetName", ep."createdTime", ep.insights, ep."insightsSyncedAt"
      FROM external_posts ep JOIN targets t ON t.id = ep."targetId"
      JOIN social_accounts sa ON sa.id = t."socialAccountId"
      WHERE ep."targetId" IN (${Prisma.join(targetIds)}) AND t."workspaceId" = ${request.workspaceId} AND t.type = 'page'
        AND sa."workspaceId" = ${request.workspaceId} AND sa.provider = 'facebook' AND sa."invalidatedAt" IS NULL
        AND ep."createdTime" >= ${request.range.from} AND ep."createdTime" <= ${request.range.to} AND ep."insightsSyncedAt" IS NOT NULL
      ORDER BY ep."createdTime" DESC LIMIT ${presentation['meta.postSeriesMaxPosts'] as number}`))
      .map(row => ({ createdTime: row.createdTime, insights: row.insights, insightsSyncedAt: row.insightsSyncedAt, target: { id: row.targetId, name: row.targetName } }) satisfies PostRow) : [];
    const normalized = normalizeFacebookAnalytics({ locale, postRows: postRows as PostRow[], metricLabels: presentation['meta.metricLabels'] as PagePresentation['metricLabels'], pageCopy: presentation['meta.pageAnalyticsCopy'] as PagePresentation['pageCopy'], pageRows: [...rollupDayRows, ...detailedPageRows] as PageRow[], selectedTargets, audienceRows: audienceRows as PageRow[], adRows: adRows as AdRow[], selectedAdAccounts, audienceAsOf: request.range.to, weeklySeriesNote: rollup?.granularity === 'weekly' });
    return { targets: visible.map(({ socialAccountId: _socialAccountId, providerId: _pageId, ...target }) => ({ ...target, providerId: FACEBOOK_PLATFORM_ID })), selectedTargets: selectedTargets.map(({ socialAccountId: _socialAccountId, providerId: _pageId, ...target }) => ({ ...target, providerId: FACEBOOK_PLATFORM_ID })), adAccounts, selectedAdAccountIds, ...normalized };
  },
};
