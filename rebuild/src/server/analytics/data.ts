import { prisma } from '@/server/data';
import { enabledSocialAccountWhere } from '@/server/platforms/registry';
import { dayEndInstant, dayStartInstant, resolveDayRange, safeTimeZone, type DayRange } from './time';

/** `from`/`to` are the first and last instants of the first and last day in the workspace time zone; `days` are those calendar days. */
export type AnalyticsRange = { from: Date; to: Date; days?: DayRange; timeZone?: string };

export function analyticsRange(start?: string, end?: string, now = new Date(), timeZone = 'UTC', maxDays = 400): AnalyticsRange {
  const zone = safeTimeZone(timeZone);
  const days = resolveDayRange(start, end, now, zone, { maxDays });
  return { from: dayStartInstant(days.start, zone), to: dayEndInstant(days.end, zone), days, timeZone: zone };
}

export async function loadAnalytics(workspaceId: string, targetIds: string[], range: AnalyticsRange, allowedTargetIds?: readonly string[], selectedAdAccountIds?: readonly string[]) {
  const instagramAccounts = await prisma.instagramAccount.findMany({
    where: { workspaceId, enabled: true },
    select: { igUserId: true, followersCount: true, lastSyncedAt: true, updatedAt: true },
  });
  const allowedIds = allowedTargetIds === undefined ? undefined : new Set(allowedTargetIds);
  const targets = (await prisma.target.findMany({
    where: { workspaceId, enabled: true, socialAccount: { is: await enabledSocialAccountWhere() }, OR: [{ type: { not: 'instagram' } }, { type: 'instagram', providerId: { in: instagramAccounts.map(account => account.igUserId) } }] }, orderBy: [{ type: 'asc' }, { name: 'asc' }],
    select: { id: true, type: true, name: true, providerId: true, socialAccountId: true },
  })).filter(target => allowedIds === undefined || allowedIds.has(target.id));
  const selectedTargets = targets.filter(target => targetIds.includes(target.id) && (allowedIds === undefined || allowedIds.has(target.id)));
  const selectedIds = selectedTargets.map(target => target.id);
  const socialAccountIds = [...new Set(selectedTargets.map(target => target.socialAccountId).filter((id): id is string => Boolean(id)))];
  const adAccounts = socialAccountIds.length ? await prisma.adAccount.findMany({
    where: { workspaceId, socialAccountId: { in: socialAccountIds }, enabled: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, currency: true },
  }) : [];
  const selectedAdIds = selectedAdAccountIds === undefined ? adAccounts.map(account => account.id)
    : adAccounts.filter(account => selectedAdAccountIds.includes(account.id)).map(account => account.id);
  const selectedInstagramIds = selectedTargets.filter(target => target.type === 'instagram').map(target => target.providerId);
  const selectedInstagramAudience = instagramAccounts.filter(account => selectedInstagramIds.includes(account.igUserId));
  const [pageRows, instagramRows, audienceRows, adRows] = await Promise.all([
    prisma.pageInsight.findMany({
      where: { targetId: { in: selectedIds }, target: { workspaceId, type: 'page' }, endTime: { gte: range.from, lte: range.to } },
      orderBy: [{ endTime: 'asc' }, { metric: 'asc' }],
      select: { metric: true, period: true, endTime: true, numeric: true, value: true, fetchedAt: true, target: { select: { id: true, name: true } } },
    }),
    prisma.instagramInsight.findMany({
      where: { account: { workspaceId, enabled: true, igUserId: { in: selectedInstagramIds } }, endTime: { gte: range.from, lte: range.to } },
      orderBy: [{ endTime: 'asc' }, { metric: 'asc' }],
      select: { metric: true, period: true, endTime: true, numeric: true, value: true, fetchedAt: true, account: { select: { id: true, igUserId: true, username: true } } },
    }),
    prisma.pageInsight.findMany({
      where: { targetId: { in: selectedTargets.filter(target => target.type === 'page').map(target => target.id) }, target: { workspaceId, type: 'page' }, metric: { in: ['page_follows', 'page_fans'] }, numeric: { not: null } },
      orderBy: [{ endTime: 'desc' }, { fetchedAt: 'desc' }],
      select: { metric: true, numeric: true, endTime: true, fetchedAt: true, target: { select: { id: true, name: true } } },
    }),
    selectedAdIds.length ? prisma.adInsight.findMany({
      where: { adAccount: { workspaceId, id: { in: selectedAdIds }, socialAccountId: { in: socialAccountIds }, enabled: true }, level: 'account', date: { gte: range.from, lte: range.to } },
      orderBy: [{ date: 'asc' }],
      select: { date: true, spend: true, impressions: true, clicks: true, reach: true, cpc: true, cpm: true, cpp: true, ctr: true, frequency: true, actions: true, fields: true, fetchedAt: true, adAccount: { select: { id: true, name: true, currency: true, socialAccountId: true } } },
    }) : Promise.resolve([]),
  ]);
  return { targets, selectedTargets, pageRows, audienceRows, instagramRows, selectedInstagramAudience, adRows, adAccounts, selectedAdIds, adAccountCount: selectedAdIds.length, range };
}
