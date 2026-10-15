import { prisma } from '@/server/data';

export type AnalyticsRange = { from: Date; to: Date };

export function analyticsRange(start?: string, end?: string, now = new Date()): AnalyticsRange {
  const valid = (value?: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
  const to = valid(end) ? new Date(`${end}T23:59:59.999`) : new Date(now);
  const from = valid(start) ? new Date(`${start}T00:00:00`) : new Date(to.getTime() - 29 * 86_400_000);
  if (from > to) return { from: new Date(to.getTime() - 29 * 86_400_000), to };
  return { from, to };
}

export async function loadAnalytics(workspaceId: string, targetIds: string[], range: AnalyticsRange) {
  const targets = await prisma.target.findMany({
    where: { workspaceId, enabled: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }],
    select: { id: true, type: true, name: true, socialAccountId: true },
  });
  const selectedTargets = targets.filter(target => targetIds.includes(target.id));
  const selectedIds = selectedTargets.map(target => target.id);
  const socialAccountIds = [...new Set(selectedTargets.map(target => target.socialAccountId).filter((id): id is string => Boolean(id)))];
  const [pageRows, audienceRows, adRows, adAccountCount] = await Promise.all([
    prisma.pageInsight.findMany({
      where: { targetId: { in: selectedIds }, target: { workspaceId, type: 'page' }, endTime: { gte: range.from, lte: range.to } },
      orderBy: [{ endTime: 'asc' }, { metric: 'asc' }],
      select: { metric: true, period: true, endTime: true, numeric: true, value: true, fetchedAt: true, target: { select: { id: true, name: true } } },
    }),
    prisma.pageInsight.findMany({
      where: { targetId: { in: selectedTargets.filter(target => target.type === 'page').map(target => target.id) }, target: { workspaceId, type: 'page' }, metric: { in: ['page_follows', 'page_fans'] }, numeric: { not: null } },
      orderBy: [{ endTime: 'desc' }, { fetchedAt: 'desc' }],
      select: { metric: true, numeric: true, endTime: true, fetchedAt: true, target: { select: { id: true, name: true } } },
    }),
    socialAccountIds.length ? prisma.adInsight.findMany({
      where: { adAccount: { workspaceId, socialAccountId: { in: socialAccountIds }, enabled: true }, level: 'account', date: { gte: range.from, lte: range.to } },
      orderBy: [{ date: 'asc' }],
      select: { date: true, spend: true, impressions: true, clicks: true, reach: true, cpc: true, cpm: true, cpp: true, ctr: true, frequency: true, actions: true, fields: true, fetchedAt: true, adAccount: { select: { id: true, name: true, currency: true, socialAccountId: true } } },
    }) : Promise.resolve([]),
    socialAccountIds.length ? prisma.adAccount.count({ where: { workspaceId, socialAccountId: { in: socialAccountIds }, enabled: true } }) : Promise.resolve(0),
  ]);
  return { targets, selectedTargets, pageRows, audienceRows, adRows, adAccountCount, range };
}
