import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import { prisma } from "@/server/data";
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import type { AdsFilters } from '@/modules/ads/report-filters';
import { OperationError } from '@/lib/operation-error';
import { AdsReportLimitError } from '@/modules/ads/read-policy';
import { loadAdsReadPolicy } from '@/modules/ads/server/read-policy';
export { parseAdsFilters, AdsFilterError, type AdsFilters, type AdsPeriod, type AdsSearchParams } from '@/modules/ads/report-filters';

export type AdsInsightLevel = 'account' | 'campaign' | 'adset' | 'ad';
/** `allowedAdAccountIds` is an independent ceiling: undefined keeps current behavior, [] allows no account. */
export type AdsDatasetOptions = { levels?: readonly AdsInsightLevel[]; objectId?: string; allowedAdAccountIds?: readonly string[] };
const ADS_INSIGHT_LEVELS: readonly AdsInsightLevel[] = ['account', 'campaign', 'adset', 'ad'];

/** Read only the accounts and stored insight rows belonging to this workspace. */
export async function getAdsDataset(workspaceId: string, filters: AdsFilters, allowedTargetIds: readonly string[] | undefined, allowedProviders: readonly string[], options: AdsDatasetOptions = {}) {
  return withAdsCopySnapshot(async () => {
  const policy = await loadAdsReadPolicy();
  const levels: unknown = options.levels;
  if (levels !== undefined && (!Array.isArray(levels) || levels.length === 0 || new Set(levels).size !== levels.length || levels.some(level => typeof level !== 'string' || !ADS_INSIGHT_LEVELS.includes(level as AdsInsightLevel)))) {
    throw new OperationError('invalid_request', await adsServiceText('service022'));
  }
  const selectedLevels = levels as readonly AdsInsightLevel[] | undefined;
  const objectId: unknown = options.objectId;
  if (objectId !== undefined && (typeof objectId !== 'string' || !objectId || /[\u0000-\u001f\u007f]/.test(objectId) || !selectedLevels || selectedLevels.length !== 1 || !filters.accountId)) {
    throw new OperationError('invalid_request', await adsServiceText('service023'));
  }
  const accounts = await getAdsAccounts(workspaceId, allowedTargetIds, allowedProviders, options.allowedAdAccountIds);
  const visibleAccountIds = accounts.map(account => account.id);
  const currentAccountScope = await getAdsAccountWhere(workspaceId, allowedTargetIds, allowedProviders, options.allowedAdAccountIds);
  const insights = await prisma.adInsight.findMany({
    where: {
      adAccount: { ...currentAccountScope, id: { in: filters.accountId ? visibleAccountIds.filter(id => id === filters.accountId) : visibleAccountIds } },
      date: { gte: filters.since, lt: filters.until },
      ...(selectedLevels !== undefined ? { level: { in: [...selectedLevels] } } : {}),
      ...(objectId !== undefined ? { objectId } : {}),
    },
    orderBy: [{ level: "asc" }, { objectName: "asc" }, { date: "desc" }, { id: "asc" }],
    take: policy.maxRows + 1,
    select: {
      id: true, adAccountId: true, level: true, objectId: true, objectName: true, date: true, fetchedAt: true,
      spend: true, impressions: true, clicks: true, reach: true, cpc: true, cpm: true,
      cpp: true, ctr: true, frequency: true, actions: true, fields: true,
      adAccount: { select: { id: true, name: true, currency: true } },
    },
  });
  if (insights.length > policy.maxRows) throw new AdsReportLimitError();
  return { accounts, insights, pageSize: policy.pageSize, maxRows: policy.maxRows };

  });
}

/** Query predicate for enabled, selected ad accounts from installed and enabled platform modules. */
export async function getAdsAccountWhere(workspaceId: string, allowedTargetIds: readonly string[] | undefined, allowedProviders: readonly string[], allowedAdAccountIds?: readonly string[]) {
  return withAdsCopySnapshot(async () => {
  const socialAccountIds = allowedTargetIds === undefined ? undefined : (await prisma.target.findMany({
    where: { workspaceId, id: { in: [...allowedTargetIds] } },
    select: { socialAccountId: true },
  })).map(target => target.socialAccountId).filter((id): id is string => Boolean(id));
  return {
    workspaceId,
    enabled: true,
    socialAccount: { is: await selectedResourceConnectionWhere(workspaceId, allowedProviders) },
    ...(socialAccountIds !== undefined ? { socialAccountId: { in: socialAccountIds } } : {}),
    // Independent of channel authority: explicit account ids only narrow the intersection above.
    ...(allowedAdAccountIds !== undefined ? { id: { in: [...allowedAdAccountIds] } } : {}),
  };

  });
}

export async function getAdsAccounts(workspaceId: string, allowedTargetIds: readonly string[] | undefined, allowedProviders: readonly string[], allowedAdAccountIds?: readonly string[]) {
  return withAdsCopySnapshot(async () => {
  const where = await getAdsAccountWhere(workspaceId, allowedTargetIds, allowedProviders, allowedAdAccountIds);
  return prisma.adAccount.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, actId: true, name: true, currency: true, accountStatus: true, enabled: true, lastSyncedAt: true, socialAccount: { select: { provider: true } } },
  });

  });
}
