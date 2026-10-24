import { localizeAdsMessage } from '../copy';
import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { defaultAdsText } from '@/modules/ads/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import { loadAdsCopy } from '../server/copy';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { getAdsAccounts, getAdsDataset, type AdsInsightLevel } from '@/modules/ads/server/queries';
import { parseAdsPerformanceFilters } from '../performance-filters';
import { assertAdsResultCeiling } from '../result-ceiling';
import { adsIsoDay } from '../report-filters';
import { authorizeAdsRead, type AdsReadActor } from '../server/access';
import { loadAdsReportPolicy } from '../server/report-policy';
import { loadAdsOutputPolicy } from '../server/output-policy';
import { ADS_ANALYSIS_POLICY_SCHEMA } from './config';
import { buildAdsComparisonCsv } from './csv';
import {
  OBJECT_SORT_KEYS, assessFreshness, buildFindings, buildKpis, findingMessage, peakReach, previousWindow, sortObjects, spendSharePercent, sumActions, totalsFromRows,
  type AdsAnalysisPolicy, type AdsObjectSortKey,
} from './metrics';

const INPUT_KEYS = new Set(['period', 'start', 'end', 'accountId', 'compare', 'level', 'sort', 'direction']);
const OBJECT_LEVELS = ['campaign', 'adset', 'ad'] as const;

export async function loadAdsAnalysisPolicy(readConfig: typeof runtimeConfig = runtimeConfig): Promise<AdsAnalysisPolicy> {
  return withAdsCopySnapshot(async () => {
  try { return ADS_ANALYSIS_POLICY_SCHEMA.parse(await readConfig('ads.analysisPolicy')); }
  catch { throw new OperationError('unavailable', await adsServiceText('service075')); }

  });
}

type Row = { adAccountId: string; level: string; objectId: string; objectName: string | null; date: Date; fetchedAt: Date | null; spend: number; impressions: number; clicks: number; reach?: number; actions?: unknown; adAccount: { id: string; name: string; currency: string | null } };
const flow = (row: Row) => ({ date: adsIsoDay(row.date), spend: row.spend, impressions: row.impressions, clicks: row.clicks });
const text = (value: unknown, key: string, max: number) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new OperationError('invalid_request', defaultAdsText('validation049', { value0: key }));
  return value;
};

export type AdsComparisonResult = Awaited<ReturnType<typeof readAdsComparison>>;

/**
 * Compare the same stored data across time (previous window) or across accounts.
 * Different currencies are never summed together: each currency forms its own group.
 */
export async function readAdsComparison(actor: AdsReadActor, input: unknown = {}, now = new Date()) {
  return withAdsCopySnapshot(async () => {
  return buildAdsComparison(actor, input, now, false);

  });
}

async function buildAdsComparison(actor: AdsReadActor, input: unknown, now: Date, complete: boolean) {
  const catalogs = await loadAdsCopy();
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('invalid_request', await adsServiceText('service076'));
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some(key => !INPUT_KEYS.has(key))) throw new OperationError('invalid_request', await adsServiceText('service076'));
  const access = await authorizeAdsRead(actor, 'ads/compare');
  const [reportPolicy, policy] = await Promise.all([loadAdsReportPolicy(), loadAdsAnalysisPolicy()]);
  const max = reportPolicy.maxFilterCharacters;
  const compare = text(values.compare, 'comparison', max) ?? 'previous';
  if (compare !== 'previous' && compare !== 'accounts') throw new OperationError('invalid_request', await adsServiceText('service077'));
  const level = (text(values.level, 'level', max) ?? 'campaign') as (typeof OBJECT_LEVELS)[number];
  if (!OBJECT_LEVELS.includes(level)) throw new OperationError('invalid_request', await adsServiceText('service078'));
  const sort = (text(values.sort, 'sort', max) ?? 'spend') as AdsObjectSortKey;
  if (!OBJECT_SORT_KEYS.includes(sort)) throw new OperationError('invalid_request', await adsServiceText('service079'));
  const direction = text(values.direction, 'sort direction', max) ?? (sort === 'name' ? 'asc' : 'desc');
  if (direction !== 'asc' && direction !== 'desc') throw new OperationError('invalid_request', await adsServiceText('service080'));

  const accounts = await getAdsAccounts(actor.workspaceId, access.allowedTargetIds, access.allowedProviders, access.allowedAdAccountIds);
  const { period, start, end, accountId } = values as Record<string, string | undefined>;
  const filters = parseAdsPerformanceFilters({
    ...(period === undefined ? {} : { period }), ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }), ...(accountId === undefined ? {} : { accountId }),
  }, accounts.map(account => account.id), now, reportPolicy);
  const selectedAccounts = accounts.filter(account => !filters.accountId || account.id === filters.accountId);
  if (compare === 'accounts' && selectedAccounts.length > policy.maxCompareAccounts) throw new OperationError('invalid_request', defaultAdsText('validation050', { value0: policy.maxCompareAccounts }));

  const levels: AdsInsightLevel[] = ['account', level];
  const currentSet = await getAdsDataset(actor.workspaceId, filters, access.allowedTargetIds, access.allowedProviders, { levels, allowedAdAccountIds: access.allowedAdAccountIds });
  const current = currentSet.insights as unknown as Row[];
  let previousRows: Row[] = [];
  if (compare === 'previous') {
    const window = previousWindow(filters.since, filters.until);
    // Every surface uses the same account and exact-object baseline. Output
    // pagination must not change which stored levels contribute to a comparison.
    previousRows = (await getAdsDataset(actor.workspaceId, { ...filters, ...window }, access.allowedTargetIds, access.allowedProviders, { levels, allowedAdAccountIds: access.allowedAdAccountIds })).insights as unknown as Row[];
  }

  const previousByObject = new Map<string, Row[]>();
  const identity = (row: Row) => JSON.stringify([row.adAccountId, row.objectId]);
  for (const row of previousRows) if (row.level === level) {
    const key = identity(row);
    if (!previousByObject.has(key)) previousByObject.set(key, []);
    previousByObject.get(key)!.push(row);
  }

  const accountMeta = new Map(currentSet.accounts.map(account => [account.id, account]));
  const groupKey = (row: Row) => compare === 'accounts' ? row.adAccountId
    : row.adAccount.currency === null ? `unknown:${row.adAccountId}` : `currency:${row.adAccount.currency}`;
  const groups = new Map<string, { key: string; currency: string | null; accountIds: Set<string> }>();
  for (const row of [...current, ...previousRows]) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, { key, currency: row.adAccount.currency, accountIds: new Set() });
    groups.get(key)!.accountIds.add(row.adAccountId);
  }
  // Selected accounts without data still appear so missing data stays visible (unknown, not zero).
  if (compare === 'accounts') for (const account of selectedAccounts) if (!groups.has(account.id)) groups.set(account.id, { key: account.id, currency: account.currency, accountIds: new Set([account.id]) });

  const result = [...groups.values()].map(group => {
    const accountRows = current.filter(row => row.level === 'account' && groupKey(row) === group.key);
    const objectRows = current.filter(row => row.level === level && groupKey(row) === group.key);
    const totals = accountRows.length ? totalsFromRows(accountRows.map(flow)) : null;
    const prevRows = previousRows.filter(row => row.level === 'account' && groupKey(row) === group.key);
    const previous = compare === 'previous' && prevRows.length ? totalsFromRows(prevRows.map(flow)) : null;
    const byObject = new Map<string, Row[]>();
    for (const row of objectRows) {
      const key = identity(row);
      if (!byObject.has(key)) byObject.set(key, []);
      byObject.get(key)!.push(row);
    }
    const objects = [...byObject.values()].map(rows => {
      const t = totalsFromRows(rows.map(flow));
      const latest = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime())[0]!;
      const earlier = previousByObject.get(identity(latest)) ?? [];
      const previous = earlier.length ? totalsFromRows(earlier.map(flow)) : null;
      const byDay = new Map<string, ReturnType<typeof flow>[]>();
      for (const row of rows) {
        const date = adsIsoDay(row.date);
        if (!byDay.has(date)) byDay.set(date, []);
        byDay.get(date)!.push(flow(row));
      }
      return {
        previous, kpis: buildKpis(t, previous),
        trend: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({ date, ...totalsFromRows(rows) })),
        objectId: latest.objectId, name: latest.objectName || latest.objectId, accountId: latest.adAccountId, accountName: latest.adAccount.name,
        spend: t.spend, impressions: t.impressions, clicks: t.clicks, cpc: t.cpc, ctr: t.ctr, cpm: t.cpm,
        sharePercent: spendSharePercent(t.spend, totals?.spend ?? null),
        reachPeakDay: peakReach(rows.map(row => row.reach).filter((value): value is number => typeof value === 'number')),
        actions: sumActions(rows.map(row => row.actions)),
      };
    });
    const trendByDay = new Map<string, { date: string; spend: number; impressions: number; clicks: number }>();
    for (const row of accountRows) {
      const date = adsIsoDay(row.date);
      const slot = trendByDay.get(date) ?? { date, spend: 0, impressions: 0, clicks: 0 };
      slot.spend += row.spend; slot.impressions += row.impressions; slot.clicks += row.clicks; trendByDay.set(date, slot);
    }
    const findings = totals ? buildFindings({ current: totals, previous, objects, policy }) : [];
    const names = [...group.accountIds].map(id => accountMeta.get(id)?.name ?? current.find(row => row.adAccountId === id)?.adAccount.name ?? id);
    return {
      key: group.key, currency: group.currency,
      accounts: [...group.accountIds].map((id, index) => ({ id, name: names[index]!, lastSyncedAt: accountMeta.get(id)?.lastSyncedAt?.toISOString() ?? null })),
      coverage: accountRows.length ? { firstDay: adsIsoDay(accountRows.reduce((a, b) => (b.date < a ? b.date : a), accountRows[0]!.date)), lastDay: adsIsoDay(accountRows.reduce((a, b) => (b.date > a ? b.date : a), accountRows[0]!.date)) } : null,
      actions: sumActions(accountRows.map(row => row.actions)),
      hasData: accountRows.length > 0 || objectRows.length > 0,
      accountTotalsAvailable: accountRows.length > 0,
      totals, previous, kpis: totals ? buildKpis(totals, previous) : [],
      findings: findings.map(finding => ({ ...finding, message: localizeAdsMessage(catalogs, 'en', findingMessage(finding)) })),
      objects: sortObjects(objects, sort, direction).slice(0, complete ? undefined : policy.maxObjects), objectCount: objects.length,
      trend: [...trendByDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map(day => ({ ...day, spend: Math.round(day.spend * 100) / 100 })),
      freshness: assessFreshness((accountRows.length ? accountRows : objectRows).map(row => row.fetchedAt), now, policy.staleAfterHours),
    };
  }).sort((a, b) => {
    if (a.totals === null && b.totals === null) return a.key.localeCompare(b.key);
    if (a.totals === null) return 1;
    if (b.totals === null) return -1;
    return (b.totals.spend - a.totals.spend) || a.key.localeCompare(b.key);
  });

  return {
    compare, level, sort, direction,
    range: { from: adsIsoDay(filters.since), to: adsIsoDay(filters.until), endExclusive: true as const },
    previousRange: compare === 'previous' ? (() => { const w = previousWindow(filters.since, filters.until); return { from: adsIsoDay(w.since), to: adsIsoDay(w.until), endExclusive: true as const }; })() : null,
    accountId: filters.accountId, groups: result,
    notes: [await adsServiceText('service081'), await adsServiceText('service082'), await adsServiceText('service083')],
    generatedAt: now.toISOString(),
  };
}

/** Complete stored objects or findings; dataset row and UTF-8 export byte limits both apply. */
export async function exportAdsComparison(actor: AdsReadActor, input: unknown = {}, now = new Date(), options: { kind?: unknown; locale?: unknown; resultLimit?: number } = {}) {
  return withAdsCopySnapshot(async () => {
  const kind = options.kind ?? 'objects';
  const locale = options.locale ?? 'en';
  if (kind !== 'objects' && kind !== 'findings') throw new OperationError('invalid_request', await adsServiceText('service084'));
  if (locale !== 'en' && locale !== 'fr') throw new OperationError('invalid_request', await adsServiceText('service085'));
  const [outputPolicy, result] = await Promise.all([loadAdsOutputPolicy(), buildAdsComparison(actor, input, now, true)]);
  if (result.groups.some(group => group.objectCount !== group.objects.length)) throw new OperationError('invalid_request', await adsServiceText('service086'));
  if (kind === 'objects') assertAdsResultCeiling(result, options.resultLimit);
  const built = buildAdsComparisonCsv(result, outputPolicy.exportMaxBytes, kind, locale, (await loadAdsCopy()).analysis);
  const base = outputPolicy.exportFileName.replace(/\.csv$/i, '');
  return { format: 'ms-social-pilot-ads-comparison-csv' as const, version: 1 as const, fileName: `${base}-comparison${kind === 'findings' ? '-findings' : ''}-${result.range.from}_${result.range.to}.csv`, ...built };

  });
}
