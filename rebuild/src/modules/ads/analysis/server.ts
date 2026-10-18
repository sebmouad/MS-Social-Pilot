import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { getAdsAccounts, getAdsDataset, type AdsInsightLevel } from '@/server/ads/queries';
import { parseAdsPerformanceFilters } from '../performance-filters';
import { adsIsoDay } from '../report-filters';
import { authorizeAdsRead, type AdsReadActor } from '../server/access';
import { loadAdsReportPolicy } from '../server/report-policy';
import { ADS_ANALYSIS_POLICY_SCHEMA } from './config';
import {
  OBJECT_SORT_KEYS, assessFreshness, buildFindings, buildKpis, findingMessage, previousWindow, sortObjects, totalsFromRows,
  type AdsAnalysisPolicy, type AdsObjectFigures, type AdsObjectSortKey,
} from './metrics';

const INPUT_KEYS = new Set(['period', 'start', 'end', 'accountId', 'compare', 'level', 'sort', 'direction']);
const OBJECT_LEVELS = ['campaign', 'adset', 'ad'] as const;

export async function loadAdsAnalysisPolicy(readConfig: typeof runtimeConfig = runtimeConfig): Promise<AdsAnalysisPolicy> {
  try { return ADS_ANALYSIS_POLICY_SCHEMA.parse(await readConfig('ads.analysisPolicy')); }
  catch { throw new OperationError('unavailable', 'Ads comparison is temporarily unavailable. Try again later.'); }
}

type Row = { adAccountId: string; level: string; objectId: string; objectName: string | null; date: Date; fetchedAt: Date | null; spend: number; impressions: number; clicks: number; adAccount: { id: string; name: string; currency: string | null } };
const flow = (row: Row) => ({ date: adsIsoDay(row.date), spend: row.spend, impressions: row.impressions, clicks: row.clicks });
const text = (value: unknown, key: string, max: number) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new OperationError('invalid_request', `Choose a valid ${key}.`);
  return value;
};

export type AdsComparisonResult = Awaited<ReturnType<typeof readAdsComparison>>;

/**
 * Compare the same stored data across time (previous window) or across accounts.
 * Different currencies are never summed together: each currency forms its own group.
 */
export async function readAdsComparison(actor: AdsReadActor, input: unknown = {}, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('invalid_request', 'Choose valid Ads comparison filters.');
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some(key => !INPUT_KEYS.has(key))) throw new OperationError('invalid_request', 'Choose valid Ads comparison filters.');
  const access = await authorizeAdsRead(actor, 'ads/compare');
  const [reportPolicy, policy] = await Promise.all([loadAdsReportPolicy(), loadAdsAnalysisPolicy()]);
  const max = reportPolicy.maxFilterCharacters;
  const compare = text(values.compare, 'comparison', max) ?? 'previous';
  if (compare !== 'previous' && compare !== 'accounts') throw new OperationError('invalid_request', 'Choose to compare with the previous period or across accounts.');
  const level = (text(values.level, 'level', max) ?? 'campaign') as (typeof OBJECT_LEVELS)[number];
  if (!OBJECT_LEVELS.includes(level)) throw new OperationError('invalid_request', 'Choose campaigns, ad sets or ads.');
  const sort = (text(values.sort, 'sort', max) ?? 'spend') as AdsObjectSortKey;
  if (!OBJECT_SORT_KEYS.includes(sort)) throw new OperationError('invalid_request', 'Choose a valid sort column.');
  const direction = text(values.direction, 'sort direction', max) ?? (sort === 'name' ? 'asc' : 'desc');
  if (direction !== 'asc' && direction !== 'desc') throw new OperationError('invalid_request', 'Choose ascending or descending order.');

  const accounts = await getAdsAccounts(actor.workspaceId, access.allowedTargetIds, access.allowedProviders, access.allowedAdAccountIds);
  const { period, start, end, accountId } = values as Record<string, string | undefined>;
  const filters = parseAdsPerformanceFilters({
    ...(period === undefined ? {} : { period }), ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }), ...(accountId === undefined ? {} : { accountId }),
  }, accounts.map(account => account.id), now, reportPolicy);
  const selectedAccounts = accounts.filter(account => !filters.accountId || account.id === filters.accountId);
  if (compare === 'accounts' && selectedAccounts.length > policy.maxCompareAccounts) throw new OperationError('invalid_request', `Compare at most ${policy.maxCompareAccounts} accounts. Choose a single account or fewer accounts.`);

  const levels: AdsInsightLevel[] = ['account', level];
  const currentSet = await getAdsDataset(actor.workspaceId, filters, access.allowedTargetIds, access.allowedProviders, { levels, allowedAdAccountIds: access.allowedAdAccountIds });
  const current = currentSet.insights as unknown as Row[];
  let previousRows: Row[] = [];
  if (compare === 'previous') {
    const window = previousWindow(filters.since, filters.until);
    previousRows = (await getAdsDataset(actor.workspaceId, { ...filters, ...window }, access.allowedTargetIds, access.allowedProviders, { levels: ['account'], allowedAdAccountIds: access.allowedAdAccountIds })).insights as unknown as Row[];
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
    const prevRows = previousRows.filter(row => groupKey(row) === group.key);
    const previous = compare === 'previous' && prevRows.length ? totalsFromRows(prevRows.map(flow)) : null;
    const byObject = new Map<string, Row[]>();
    for (const row of objectRows) byObject.set(`${row.adAccountId}:${row.objectId}`, [...(byObject.get(`${row.adAccountId}:${row.objectId}`) ?? []), row]);
    const objects: Array<AdsObjectFigures & { accountId: string; accountName: string }> = [...byObject.values()].map(rows => {
      const t = totalsFromRows(rows.map(flow));
      const latest = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime())[0]!;
      return { objectId: latest.objectId, name: latest.objectName || latest.objectId, accountId: latest.adAccountId, accountName: latest.adAccount.name, spend: t.spend, impressions: t.impressions, clicks: t.clicks, cpc: t.cpc, ctr: t.ctr, cpm: t.cpm };
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
      key: group.key, currency: group.currency, accounts: [...group.accountIds].map((id, index) => ({ id, name: names[index]! })),
      hasData: accountRows.length > 0 || objectRows.length > 0,
      accountTotalsAvailable: accountRows.length > 0,
      totals, previous, kpis: totals ? buildKpis(totals, previous) : [],
      findings: findings.map(finding => ({ ...finding, message: findingMessage(finding) })),
      objects: sortObjects(objects, sort, direction).slice(0, policy.maxObjects), objectCount: objects.length,
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
    notes: ['Totals are recomputed from stored daily flows; ratios are not averaged.', 'Amounts in different currencies are never combined.', 'Reach is not additive and is not totalled.'],
    generatedAt: now.toISOString(),
  };
}
