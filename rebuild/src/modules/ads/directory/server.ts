import { OperationError } from '@/lib/operation-error';
import { getAdsAccounts, getAdsDataset, type AdsInsightLevel } from '@/server/ads/queries';
import { readWorkspaceAdObject } from '@/server/ads/actions';
import { loadAdsAnalysisPolicy } from '../analysis/server';
import { OBJECT_SORT_KEYS, assessFreshness, sortObjects, totalsFromRows, type AdsObjectFigures, type AdsObjectSortKey } from '../analysis/metrics';
import { parseAdsPerformanceFilters } from '../performance-filters';
import { adsIsoDay } from '../report-filters';
import { authorizeAdsRead, type AdsReadActor } from '../server/access';
import { loadAdsReadPolicy } from '../server/read-policy';
import { loadAdsReportPolicy } from '../server/report-policy';
import { adsDirectoryManagementPort } from './management-port';
import { platformAds } from '@/server/platforms/registry';

const LEVELS = ['campaign', 'adset', 'ad'] as const;
type DirectoryLevel = (typeof LEVELS)[number];
const INPUT_KEYS = new Set(['period', 'start', 'end', 'accountId', 'level', 'parentId', 'q', 'sort', 'direction', 'offset', 'limit']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

type Row = { adAccountId: string; objectId: string; objectName: string | null; date: Date; fetchedAt: Date | null; spend: number; impressions: number; clicks: number; fields: unknown; adAccount: { id: string; name: string; currency: string | null } };
const flow = (row: Row) => ({ date: adsIsoDay(row.date), spend: row.spend, impressions: row.impressions, clicks: row.clicks });
const text = (value: unknown, key: string, max: number) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new OperationError('invalid_request', `Choose a valid ${key}.`);
  return value;
};
const int = (value: unknown, min: number, max: number, fallback: number, name: string) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new OperationError('invalid_request', `Choose a ${name} from ${min} to ${max}.`);
  return value;
};

/** Browse stored campaign / ad set / ad objects with period figures, last delivery and freshness. */
export async function readAdsDirectory(actor: AdsReadActor, input: unknown = {}, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('invalid_request', 'Choose valid Ads directory filters.');
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some(key => !INPUT_KEYS.has(key))) throw new OperationError('invalid_request', 'Choose valid Ads directory filters.');
  const access = await authorizeAdsRead(actor, 'ads/objects');
  const [reportPolicy, analysisPolicy, readPolicy] = await Promise.all([loadAdsReportPolicy(), loadAdsAnalysisPolicy(), loadAdsReadPolicy()]);
  const max = reportPolicy.maxFilterCharacters;
  const level = (text(values.level, 'level', max) ?? 'campaign') as DirectoryLevel;
  if (!LEVELS.includes(level)) throw new OperationError('invalid_request', 'Choose campaigns, ad sets or ads.');
  const parentId = text(values.parentId, 'parent object', max);
  if (parentId !== undefined && !SAFE_ID.test(parentId)) throw new OperationError('invalid_request', 'Choose a valid parent object.');
  const q = text(values.q, 'search', max)?.trim().toLowerCase();
  const sort = (text(values.sort, 'sort', max) ?? 'spend') as AdsObjectSortKey;
  if (!OBJECT_SORT_KEYS.includes(sort)) throw new OperationError('invalid_request', 'Choose a valid sort column.');
  const direction = text(values.direction, 'direction', max) ?? (sort === 'name' ? 'asc' : 'desc');
  if (direction !== 'asc' && direction !== 'desc') throw new OperationError('invalid_request', 'Choose ascending or descending order.');
  const limit = int(values.limit, 1, readPolicy.maxRows, readPolicy.pageSize, 'page size');
  const offset = int(values.offset, 0, Number.MAX_SAFE_INTEGER, 0, 'offset');

  const accounts = await getAdsAccounts(actor.workspaceId, access.allowedTargetIds, access.allowedProviders, access.allowedAdAccountIds);
  const providerByAccount = new Map(accounts.map(account => [account.id, account.socialAccount?.provider]));
  const { period, start, end, accountId } = values as Record<string, string | undefined>;
  const filters = parseAdsPerformanceFilters({
    ...(period === undefined ? {} : { period }), ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }), ...(accountId === undefined ? {} : { accountId }),
  }, accounts.map(account => account.id), now, reportPolicy);
  const dataset = await getAdsDataset(actor.workspaceId, filters, access.allowedTargetIds, access.allowedProviders, { levels: [level as AdsInsightLevel], allowedAdAccountIds: access.allowedAdAccountIds });
  const rows = dataset.insights as unknown as Row[];

  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(`${row.adAccountId}:${row.objectId}`, [...(groups.get(`${row.adAccountId}:${row.objectId}`) ?? []), row]);
  type ParentResolver = (input: { level: DirectoryLevel; fields: unknown }) => string | null;
  const resolverByProvider = new Map<string, Promise<ParentResolver | null>>();
  const parentFor = async (provider: string | undefined, objectLevel: DirectoryLevel, fields: unknown) => {
    if (!provider || objectLevel === 'campaign') return null;
    if (!resolverByProvider.has(provider)) resolverByProvider.set(provider, platformAds(provider).then(host => {
      const resolver = host && (host as typeof host & { parentObjectId?: ParentResolver }).parentObjectId;
      return typeof resolver === 'function' ? resolver : null;
    }).catch(() => null));
    const resolver = await resolverByProvider.get(provider)!;
    try {
      const value = resolver?.({ level: objectLevel, fields });
      return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
    } catch { return null; }
  };
  type Item = AdsObjectFigures & { accountId: string; accountName: string; currency: string | null; parentId: string | null; level: DirectoryLevel; lastDeliveryDate: string | null; lastFetchedAt: string | null };
  let items: Item[] = await Promise.all([...groups.values()].map(async group => {
    const latest = [...group].sort((a, b) => b.date.getTime() - a.date.getTime())[0]!;
    const totals = totalsFromRows(group.map(flow));
    const delivered = group.filter(row => row.impressions > 0 || row.spend > 0).sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    const fetched = assessFreshness(group.map(row => row.fetchedAt), now, analysisPolicy.staleAfterHours);
    return {
      objectId: latest.objectId, name: latest.objectName || latest.objectId, spend: totals.spend, impressions: totals.impressions, clicks: totals.clicks, cpc: totals.cpc, ctr: totals.ctr, cpm: totals.cpm,
      accountId: latest.adAccountId, accountName: latest.adAccount.name, currency: latest.adAccount.currency, level,
      parentId: await parentFor(providerByAccount.get(latest.adAccountId), level, latest.fields),
      lastDeliveryDate: delivered ? adsIsoDay(delivered.date) : null, lastFetchedAt: fetched.newestFetchAt,
    };
  }));
  if (parentId !== undefined) items = items.filter(item => item.parentId === parentId);
  if (q) items = items.filter(item => item.name.toLowerCase().includes(q) || item.objectId.toLowerCase().includes(q));
  const total = items.length;
  const sorted = sortObjects(items, sort, direction);
  const page = sorted.slice(offset, offset + limit);
  return {
    level, sort, direction, q: q ?? null, parentId: parentId ?? null, accountId: filters.accountId,
    range: { from: adsIsoDay(filters.since), to: adsIsoDay(filters.until), endExclusive: true as const },
    total, offset, limit, nextOffset: offset + page.length < total ? offset + page.length : null, items: page,
    parentLinks: level === 'campaign' ? 'none' as const : items.some(item => item.parentId) ? 'stored' as const : 'unavailable' as const,
    freshness: assessFreshness(rows.map(row => row.fetchedAt), now, analysisPolicy.staleAfterHours),
    note: 'Figures come from stored daily reports. Levels overlap, so campaign, ad set and ad figures must not be added together.',
  };
}

/** One object: stored period figures, daily series, best-effort live status and the changes the actor can make. */
export async function readAdsObjectDetail(actor: AdsReadActor, input: unknown, now = new Date()) {
  const values = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const allowed = new Set(['accountId', 'level', 'objectId', 'period', 'start', 'end']);
  if (Object.keys(values).some(key => !allowed.has(key))) throw new OperationError('invalid_request', 'Choose a valid ad object.');
  const { accountId, level, objectId } = values as Record<string, string | undefined>;
  if (!accountId || !level || !LEVELS.includes(level as DirectoryLevel) || !objectId || !SAFE_ID.test(objectId)) throw new OperationError('invalid_request', 'Choose an account, a level and an object.');
  const access = await authorizeAdsRead(actor, 'ads/objects');
  const reportPolicy = await loadAdsReportPolicy();
  const accounts = await getAdsAccounts(actor.workspaceId, access.allowedTargetIds, access.allowedProviders, access.allowedAdAccountIds);
  const { period, start, end } = values as Record<string, string | undefined>;
  const filters = parseAdsPerformanceFilters({ ...(period === undefined ? {} : { period }), ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }), accountId }, accounts.map(account => account.id), now, reportPolicy);
  const dataset = await getAdsDataset(actor.workspaceId, filters, access.allowedTargetIds, access.allowedProviders, { levels: [level as AdsInsightLevel], objectId, allowedAdAccountIds: access.allowedAdAccountIds });
  const rows = dataset.insights as unknown as Row[];
  if (!rows.length) throw new OperationError('not_found', 'No stored report rows were found for this object in the selected range.');
  const totals = totalsFromRows(rows.map(flow));
  let live: { available: true; configuredStatus: string | null; effectiveStatus: string | null } | { available: false } = { available: false };
  try {
    const snapshot = await readWorkspaceAdObject({ userId: actor.userId, workspaceId: actor.workspaceId, ...(access.allowedAdAccountIds === undefined ? {} : { allowedAdAccountIds: access.allowedAdAccountIds }) }, { adAccountId: accountId, objectId, objectType: level as DirectoryLevel }, access.allowedTargetIds) as { configuredStatus?: string | null; effectiveStatus?: string | null };
    live = { available: true, configuredStatus: snapshot.configuredStatus ?? null, effectiveStatus: snapshot.effectiveStatus ?? null };
  } catch { /* live status is optional; stored figures remain valid */ }
  // Management is an optional enhancement to read-only detail. Host wiring,
  // Root config, or its ledger may be absent while stored Ads reads remain valid.
  let management: Awaited<ReturnType<NonNullable<ReturnType<typeof adsDirectoryManagementPort>>['describe']>> | null = null;
  try { management = await adsDirectoryManagementPort()?.describe(actor, accountId) ?? null; }
  catch { /* keep scoped stored reporting available if management is unavailable */ }
  return {
    accountId, level, objectId, name: rows[0]!.objectName || objectId, currency: rows[0]!.adAccount.currency, totals,
    range: { from: adsIsoDay(filters.since), to: adsIsoDay(filters.until), endExclusive: true as const },
    daily: [...rows].sort((a, b) => a.date.getTime() - b.date.getTime()).map(flow), live,
    management: management
      ? { available: true as const, canManage: management.canManage, operations: management.operations.filter(op => op.objectTypes.includes(level as DirectoryLevel)) }
      : { available: false as const, canManage: false as const, operations: [] },
  };
}
