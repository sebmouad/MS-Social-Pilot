import type { ChannelRollupRow } from '@/server/platforms/host';
import { prisma } from '@/server/data';
import { object } from './transport';

/**
 * Instagram's half of the Analytics rollup pipeline: one daily value per
 * channel and day-period metric, computed from stored account insights only.
 *
 * The aggregation mirrors the read mapping exactly so the rollup path returns
 * the same series as the detailed path: day-series flows sum every stored
 * numeric observation of the day, day-series reach and every other numeric
 * day row (older rows without a series envelope, range totals stored under a
 * day key by mistake) keep the latest observation of the day as stocks, and
 * rows without a numeric observation contribute nothing. Object-valued rows
 * (breakdowns) are left to the detailed reads; the reader falls back whenever
 * any exist. Range totals (`day:range`), non-day periods, audience snapshots
 * and media cohorts always read in detail.
 */
export async function computeInstagramDailyRollups(input: { workspaceId: string; targetIds: readonly string[]; from: Date; to: Date }): Promise<ChannelRollupRow[]> {
  const targetIds = [...new Set(input.targetIds)];
  if (!targetIds.length) return [];
  const targets = await prisma.target.findMany({
    where: {
      workspaceId: input.workspaceId, id: { in: targetIds }, enabled: true, type: 'instagram',
      socialAccount: { is: { workspaceId: input.workspaceId, provider: 'instagram', invalidatedAt: null } },
    },
    select: { id: true, providerId: true, socialAccountId: true },
  });
  if (!targets.length) return [];
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId: input.workspaceId, enabled: true, targetId: { in: targets.map(target => target.id) } },
    select: { id: true, targetId: true, igUserId: true, socialAccountId: true },
  });
  const accountByTarget = new Map<string, string>();
  for (const target of targets) {
    const account = accounts.find(item => item.targetId === target.id && item.igUserId === target.providerId && item.socialAccountId === target.socialAccountId);
    if (account?.targetId) accountByTarget.set(account.id, account.targetId);
  }
  const accountIds = [...accountByTarget.keys()];
  if (!accountIds.length) return [];
  const rows = await prisma.instagramInsight.findMany({
    where: { accountId: { in: accountIds }, period: 'day', endTime: { gte: input.from, lte: input.to } },
    orderBy: [{ endTime: 'asc' }, { fetchedAt: 'asc' }],
    select: { accountId: true, metric: true, period: true, endTime: true, numeric: true, value: true, fetchedAt: true },
  });
  type Accumulator = { kind: 'flow' | 'stock'; value: number; samples: number; asOf: Date; fetchedAt: Date };
  const days = new Map<string, Accumulator>();
  for (const row of rows) {
    const targetId = accountByTarget.get(row.accountId);
    if (!targetId || row.numeric === null || !Number.isFinite(row.numeric)) continue;
    const envelope = object(row.value);
    const versioned = envelope.instagramHostVersion === 1;
    const envelopePeriod = versioned && typeof envelope.period === 'string' ? envelope.period : row.period;
    const rangeTotal = versioned ? envelope.rangeTotal !== false : true;
    // Same rule as the read mapping: only day-series non-reach numerics sum.
    const additive = envelopePeriod === 'day' && !rangeTotal && row.metric !== 'reach';
    const stock = !additive;
    const day = row.endTime.toISOString().slice(0, 10);
    const key = JSON.stringify([targetId, row.metric, row.period ?? 'day', day]);
    const previous = days.get(key);
    if (!previous) {
      days.set(key, { kind: stock ? 'stock' : 'flow', value: row.numeric, samples: 1, asOf: row.endTime, fetchedAt: row.fetchedAt });
    } else if (stock) {
      // Same rule as the read mapping: the latest observation of the day wins.
      if (row.endTime >= previous.asOf) {
        previous.value = row.numeric;
        previous.asOf = row.endTime;
      }
      if (row.fetchedAt > previous.fetchedAt) previous.fetchedAt = row.fetchedAt;
      previous.samples++;
    } else {
      previous.value += row.numeric;
      previous.samples++;
      if (row.endTime > previous.asOf) previous.asOf = row.endTime;
      if (row.fetchedAt > previous.fetchedAt) previous.fetchedAt = row.fetchedAt;
    }
  }
  return [...days].map(([key, acc]) => {
    const [targetId, metric, period, day] = JSON.parse(key) as [string, string, string, string];
    return { targetId, metric, period, day, kind: acc.kind, value: acc.value, samples: acc.samples, asOf: acc.asOf, fetchedAt: acc.fetchedAt };
  });
}

/**
 * True when any selected channel holds non-numeric day rows in the span.
 * Those rows feed category breakdowns (or are unversioned nulls that prove
 * nothing), which rollups never precompute, so the caller must fall back to
 * detailed reads for the whole request. Conservative by design: a fallback
 * only slows the read, while a rollup over missing categories would hide them.
 */
export async function hasUnrolledInstagramDayBreakdowns(input: { workspaceId: string; targetIds: readonly string[]; from: Date; to: Date }): Promise<boolean> {
  const targetIds = [...new Set(input.targetIds)];
  if (!targetIds.length) return false;
  const rows = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM instagram_insights ii
    JOIN instagram_accounts ia ON ia.id = ii."accountId"
    JOIN targets t ON t.id = ia."targetId"
    WHERE ia."workspaceId" = ${input.workspaceId} AND t."workspaceId" = ${input.workspaceId}
      AND ia."targetId" = ANY(${targetIds}::text[]) AND t.enabled = true AND t.type = 'instagram'
      AND ia.enabled = true AND ia."igUserId" = t."providerId" AND ia."socialAccountId" = t."socialAccountId"
      AND ii.period = 'day' AND ii."endTime" >= ${input.from} AND ii."endTime" <= ${input.to}
      AND ii.numeric IS NULL LIMIT 1`;
  return rows.length > 0;
}
