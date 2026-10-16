import { prisma } from "@/server/data";
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';

export type AdsPeriod = "7d" | "30d" | "90d" | "custom";

export type AdsFilters = {
  period: AdsPeriod;
  since: Date;
  until: Date;
  accountId: string | null;
};

export type AdsSearchParams = {
  period?: string | string[];
  since?: string | string[];
  until?: string | string[];
  account?: string | string[];
};

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const isIsoDay = (value: string | undefined): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && isoDay(date) === value;
};

/** Parse bounded date/account filters from the URL. Invalid or reversed dates fall back to 30 days. */
export function parseAdsFilters(params: AdsSearchParams, accountIds: readonly string[], now = new Date()): AdsFilters {
  const requestedPeriod = first(params.period);
  const period: AdsPeriod = requestedPeriod === "7d" || requestedPeriod === "90d" || requestedPeriod === "custom" ? requestedPeriod : "30d";
  const validAccountIds = new Set(accountIds);
  const requestedAccount = first(params.account);
  const accountId = requestedAccount && validAccountIds.has(requestedAccount) ? requestedAccount : null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = first(params.since);
  const until = first(params.until);
  const customStart = isIsoDay(since) ? new Date(`${since}T00:00:00.000Z`) : null;
  const customEnd = isIsoDay(until) ? new Date(`${until}T00:00:00.000Z`) : null;
  if (period === "custom" && customStart && customEnd && customStart <= customEnd) {
    return { period, since: customStart, until: new Date(customEnd.getTime() + DAY), accountId };
  }
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  return { period: period === "custom" ? "30d" : period, since: new Date(today.getTime() - (days - 1) * DAY), until: new Date(today.getTime() + DAY), accountId };
}

/** Read only the accounts and stored insight rows belonging to this workspace. */
export async function getAdsDataset(workspaceId: string, filters: AdsFilters, allowedTargetIds?: readonly string[]) {
  const accounts = await getAdsAccounts(workspaceId, allowedTargetIds);
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
export async function getAdsAccountWhere(workspaceId: string, allowedTargetIds?: readonly string[]) {
  const socialAccountIds = allowedTargetIds === undefined ? undefined : (await prisma.target.findMany({
    where: { workspaceId, id: { in: [...allowedTargetIds] } },
    select: { socialAccountId: true },
  })).map(target => target.socialAccountId).filter((id): id is string => Boolean(id));
  return {
    workspaceId,
    enabled: true,
    socialAccount: { is: await selectedResourceConnectionWhere(workspaceId) },
    ...(socialAccountIds !== undefined ? { socialAccountId: { in: socialAccountIds } } : {}),
  };
}

export async function getAdsAccounts(workspaceId: string, allowedTargetIds?: readonly string[]) {
  const where = await getAdsAccountWhere(workspaceId, allowedTargetIds);
  return prisma.adAccount.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, actId: true, name: true, currency: true, accountStatus: true, enabled: true, lastSyncedAt: true, socialAccount: { select: { provider: true } } },
  });
}
