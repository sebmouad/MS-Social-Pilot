import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import { OperationError } from '@/lib/operation-error';
import { authorizeAdsRead, type AdsReadActor } from './access';
import { loadAdsReportPolicy } from './report-policy';
import { loadAdsReadPolicy } from './read-policy';
import { getAdsAccounts, getAdsDataset, type AdsInsightLevel } from './queries';
import { summarizeInsights } from './summary';
import { parseAdsPerformanceFilters } from '../performance-filters';

/** Current authority and independent channel/account ceilings are rechecked for both transports. */
export async function readAdsPerformance(actor: AdsReadActor, args: Record<string, unknown>, maxItems?: number) {
  return withAdsCopySnapshot(async () => {
  const access = await authorizeAdsRead(actor);
  const allowedTargetIds = access.allowedTargetIds;
  if (Object.keys(args).some(key => !['period', 'start', 'end', 'accountId', 'level', 'offset', 'limit', 'accountOffset'].includes(key))) throw new OperationError('invalid_request', await adsServiceText('service019'));
  const policy = await loadAdsReportPolicy();
  const bounds = await loadAdsReadPolicy();
  const cap = maxItems ?? bounds.pageSize;
  const accounts = await getAdsAccounts(actor.workspaceId, allowedTargetIds, access.allowedProviders, access.allowedAdAccountIds);
  const filters = parseAdsPerformanceFilters(args, accounts.map(account => account.id), new Date(), policy);
  const accountId = filters.accountId;
  const range = { from: filters.since, to: filters.until, endExclusive: true };
  const level = args.level;
  if (level !== undefined && (typeof level !== 'string' || !['campaign', 'adset', 'ad'].includes(level))) throw new OperationError('invalid_request', await adsServiceText('reportLevel'));
  const offset = args.offset === undefined ? 0 : args.offset;
  const accountOffset = args.accountOffset === undefined ? 0 : args.accountOffset;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || (args.limit !== undefined && (typeof args.limit !== 'number' || !Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > bounds.maxRows))) throw new OperationError('invalid_request', await adsServiceText('reportOffsets'));
  if (typeof accountOffset !== 'number' || !Number.isSafeInteger(accountOffset) || accountOffset < 0) throw new OperationError('invalid_request', await adsServiceText('accountOffset'));
  const levels: AdsInsightLevel[] = level === undefined ? ['campaign', 'adset', 'ad'] : [level as AdsInsightLevel];
  const { insights, pageSize } = await getAdsDataset(actor.workspaceId, filters, allowedTargetIds, access.allowedProviders, { levels, ...(access.allowedAdAccountIds === undefined ? {} : { allowedAdAccountIds: access.allowedAdAccountIds }) });
  const rows = summarizeInsights(insights, level as string | undefined).filter(row => ['campaign', 'adset', 'ad'].includes(row.level));
  const limit = args.limit === undefined ? pageSize : args.limit as number;
  const pageLimit = Math.min(limit, cap);
  const performance = rows.slice(offset, offset + pageLimit).map(row => ({
    id: row.id, name: row.name, level: row.level, accountId: row.accountId, accountName: row.accountName, currency: row.currency,
    spend: row.spend, impressions: row.impressions, clicks: row.clicks, reach: row.reach, reachDate: row.reachDate,
    cpc: row.cpc, cpm: row.cpm, cpp: row.cpp, ctr: row.ctr, frequency: row.frequency, actions: row.actions, dailyRowCount: row.rows,
  }));
  const visibleAccounts = accounts.filter(account => !accountId || account.id === accountId);
  const accountPage = visibleAccounts.slice(accountOffset, accountOffset + cap).map(({ id, name, currency }) => ({ id, name, currency }));
  return { range, reportOptions: policy, accounts: accountPage, accountCount: visibleAccounts.length, nextAccountOffset: accountOffset + accountPage.length < visibleAccounts.length ? accountOffset + accountPage.length : null, level: level ?? null, resultCount: rows.length, performance, nextOffset: offset + performance.length < rows.length ? offset + performance.length : null };

  });
}

export async function listAdsAccounts(actor: AdsReadActor, args: Record<string, unknown>, maxItems?: number) {
  return withAdsCopySnapshot(async () => {
  const access = await authorizeAdsRead(actor);
  const bounds = await loadAdsReadPolicy();
  if (Object.keys(args).some(key => !['offset', 'limit'].includes(key))) throw new OperationError('invalid_request', await adsServiceText('service020'));
  const offset = args.offset ?? 0;
  const limit = args.limit ?? bounds.pageSize;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > bounds.maxRows) throw new OperationError('invalid_request', await adsServiceText('service020'));
  const all = await getAdsAccounts(actor.workspaceId, access.allowedTargetIds, access.allowedProviders, access.allowedAdAccountIds);
  if (all.length > bounds.maxRows) throw new OperationError('unavailable', await adsServiceText('service021'));
  const pageLimit = Math.min(limit, maxItems ?? bounds.pageSize);
  const accounts = all.slice(offset, offset + pageLimit).map(({ id, actId, name, enabled, currency, accountStatus, lastSyncedAt }) => ({ id, actId, name, enabled, currency, accountStatus, lastSyncedAt }));
  return { accounts, accountCount: all.length, nextOffset: offset + accounts.length < all.length ? offset + accounts.length : null };

  });
}
