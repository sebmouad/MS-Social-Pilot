import { safeNumber } from '@/modules/analytics/server/catalog';
import type { ChannelRollupRow } from '@/server/platforms/host';
import { prisma } from '@/server/data';
import { facebookPageMetricKind } from './analytics';

/**
 * Facebook's half of the Analytics rollup pipeline: one daily value per
 * channel and day-period metric, computed from stored Page insights only.
 *
 * The aggregation mirrors the read mapping exactly so the rollup path returns
 * the same series as the detailed path: flows sum every stored observation of
 * the day, stocks keep the latest observation of the day, and rows without a
 * numeric observation contribute nothing. Object-valued rows (breakdowns) are
 * left to the detailed reads; the reader falls back whenever any exist.
 */
export async function computeFacebookDailyRollups(input: { workspaceId: string; targetIds: readonly string[]; from: Date; to: Date }): Promise<ChannelRollupRow[]> {
  const targetIds = [...new Set(input.targetIds)];
  if (!targetIds.length) return [];
  const rows = await prisma.pageInsight.findMany({
    where: {
      targetId: { in: targetIds },
      target: { workspaceId: input.workspaceId, type: 'page', socialAccount: { is: { workspaceId: input.workspaceId, provider: 'facebook', invalidatedAt: null } } },
      period: 'day',
      endTime: { gte: input.from, lte: input.to },
    },
    orderBy: [{ endTime: 'asc' }, { fetchedAt: 'asc' }],
    select: { targetId: true, metric: true, period: true, endTime: true, numeric: true, value: true, fetchedAt: true },
  });
  type Accumulator = { kind: 'flow' | 'stock'; value: number; samples: number; asOf: Date; fetchedAt: Date };
  const days = new Map<string, Accumulator>();
  for (const row of rows) {
    const value = row.numeric ?? safeNumber(row.value);
    if (value === null) continue;
    const day = row.endTime.toISOString().slice(0, 10);
    const key = JSON.stringify([row.targetId, row.metric, row.period ?? 'day', day]);
    const kind = facebookPageMetricKind(row.metric);
    const stock = kind === 'stock';
    const previous = days.get(key);
    if (!previous) {
      days.set(key, { kind: stock ? 'stock' : 'flow', value, samples: 1, asOf: row.endTime, fetchedAt: row.fetchedAt });
    } else if (stock) {
      // Same rule as the read mapping: the latest observation of the day wins.
      if (row.endTime >= previous.asOf) {
        previous.value = value;
        previous.asOf = row.endTime;
      }
      if (row.fetchedAt > previous.fetchedAt) previous.fetchedAt = row.fetchedAt;
      previous.samples++;
    } else {
      previous.value += value;
      previous.samples++;
      if (row.endTime > previous.asOf) previous.asOf = row.endTime;
      if (row.fetchedAt > previous.fetchedAt) previous.fetchedAt = row.fetchedAt;
    }
  }
  // Breakdown-kind metrics aggregate their numeric series like flows in the read
  // mapping (their categories still come from detailed reads via the fallback).
  return [...days].map(([key, acc]) => {
    const [targetId, metric, period, day] = JSON.parse(key) as [string, string, string, string];
    return { targetId, metric, period, day, kind: acc.kind, value: acc.value, samples: acc.samples, asOf: acc.asOf, fetchedAt: acc.fetchedAt };
  });
}

/**
 * True when any selected channel holds object/array-valued day rows in the
 * span. Those rows feed category breakdowns, which rollups never precompute,
 * so the caller must fall back to detailed reads for the whole request.
 */
export async function hasUnrolledDayBreakdowns(input: { workspaceId: string; targetIds: readonly string[]; from: Date; to: Date }): Promise<boolean> {
  const targetIds = [...new Set(input.targetIds)];
  if (!targetIds.length) return false;
  const rows = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM page_insights pi JOIN targets t ON t.id = pi."targetId"
    WHERE pi."targetId" = ANY(${targetIds}::text[]) AND t."workspaceId" = ${input.workspaceId}
      AND pi.period = 'day' AND pi."endTime" >= ${input.from} AND pi."endTime" <= ${input.to}
      AND jsonb_typeof(pi.value) IN ('object', 'array') LIMIT 1`;
  return rows.length > 0;
}
