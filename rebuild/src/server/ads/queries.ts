import { prisma } from "@/server/data";
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import type { AdsFilters } from '@/modules/ads/report-filters';
export { parseAdsFilters, AdsFilterError, type AdsFilters, type AdsPeriod, type AdsSearchParams } from '@/modules/ads/report-filters';

/** Read only the accounts and stored insight rows belonging to this workspace. */
export async function getAdsDataset(workspaceId: string, filters: AdsFilters, allowedTargetIds: readonly string[] | undefined, allowedProviders: readonly string[]) {
  const accounts = await getAdsAccounts(workspaceId, allowedTargetIds, allowedProviders);
  const visibleAccountIds = accounts.map(account => account.id);
  const insights = await prisma.adInsight.findMany({
    where: {
      adAccount: { workspaceId, id: { in: filters.accountId ? visibleAccountIds.filter(id => id === filters.accountId) : visibleAccountIds } },
      date: { gte: filters.since, lt: filters.until },
    },
    orderBy: [{ level: "asc" }, { objectName: "asc" }, { date: "desc" }],
    select: {
      id: true, adAccountId: true, level: true, objectId: true, objectName: true, date: true,
      spend: true, impressions: true, clicks: true, reach: true, cpc: true, cpm: true,
      cpp: true, ctr: true, frequency: true, actions: true, fields: true,
      adAccount: { select: { id: true, name: true, currency: true } },
    },
  });
  return { accounts, insights };
}

/** Query predicate for enabled, selected ad accounts from installed and enabled platform modules. */
export async function getAdsAccountWhere(workspaceId: string, allowedTargetIds: readonly string[] | undefined, allowedProviders: readonly string[]) {
  const socialAccountIds = allowedTargetIds === undefined ? undefined : (await prisma.target.findMany({
    where: { workspaceId, id: { in: [...allowedTargetIds] } },
    select: { socialAccountId: true },
  })).map(target => target.socialAccountId).filter((id): id is string => Boolean(id));
  return {
    workspaceId,
    enabled: true,
    socialAccount: { is: await selectedResourceConnectionWhere(workspaceId, allowedProviders) },
    ...(socialAccountIds !== undefined ? { socialAccountId: { in: socialAccountIds } } : {}),
  };
}

export async function getAdsAccounts(workspaceId: string, allowedTargetIds: readonly string[] | undefined, allowedProviders: readonly string[]) {
  const where = await getAdsAccountWhere(workspaceId, allowedTargetIds, allowedProviders);
  return prisma.adAccount.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, actId: true, name: true, currency: true, accountStatus: true, enabled: true, lastSyncedAt: true, socialAccount: { select: { provider: true } } },
  });
}
