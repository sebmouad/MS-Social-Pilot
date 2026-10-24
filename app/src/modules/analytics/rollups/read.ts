import { prisma } from '@/server/data';
import { configOrDefault } from '@/server/config/config-or-default';
import { isMissingRelation } from '@/modules/root/server/admin/authz';
import { ROLLUPS_POLICY_SCHEMA } from './config';
import { fullWeeksInRange, weekStartOfDay } from './weeks';

const DAY_MS = 86_400_000;
const dayStartUtc = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export type RollupSeriesRow = {
  targetId: string; metric: string; period: string; date: Date; value: number; fetchedAt: Date;
};

/**
 * Precomputed day-period series replacing part of a detailed read.
 * `daily` covers complete past days; the caller reads the intraday remainder in
 * detail. `weekly` covers the whole range (full weeks as weekly points, partial
 * edge weeks as daily points) and needs a disclosure note at the call site.
 */
export type ChannelRollupPreference = {
  granularity: 'daily' | 'weekly';
  rows: RollupSeriesRow[];
  rolledFrom: Date;
  rolledTo: Date;
};

type PreferenceInput = {
  provider: string; workspaceId: string; targetIds: readonly string[]; from: Date; to: Date;
  granularities?: ReadonlyArray<'daily' | 'weekly'>; today?: Date;
};

/**
 * Prefer precomputed rollups when a fresh worker run covers the request, else
 * fall back to detailed stored reads (null). A run qualifies only when it
 * finished today (so every rolled complete day saw the whole day's syncs),
 * its window starts at or before the request, and it processed every selected
 * channel. Missing tables mid-deploy also fall back.
 */
export async function readChannelRollupPreference(input: PreferenceInput): Promise<ChannelRollupPreference | null> {
  const targetIds = [...new Set(input.targetIds)];
  if (!targetIds.length || input.to < input.from) return null;
  try {
    const policy = await configOrDefault('analytics.rollups.policy', ROLLUPS_POLICY_SCHEMA);
    const granularities = input.granularities ?? (
      Math.ceil((input.to.getTime() - input.from.getTime()) / DAY_MS) > policy.weeklyThresholdDays
        ? ['weekly', 'daily'] as const : ['daily'] as const);
    const todayStart = dayStartUtc(input.today ?? new Date());
    for (const granularity of granularities) {
      const preference = granularity === 'weekly'
        ? await weeklyPreference({ ...input, targetIds, todayStart })
        : await dailyPreference({ ...input, targetIds, todayStart });
      if (preference) return preference;
    }
    return null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

async function coveringRun(provider: string, workspaceId: string, granularity: 'daily' | 'weekly', targetIds: string[], from: Date, todayStart: Date) {
  const runs = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM analytics_rollup_runs
    WHERE "workspaceId" = ${workspaceId} AND provider = ${provider} AND granularity = ${granularity}
      AND status IN ('completed', 'partial') AND "windowFrom" <= ${from} AND "finishedAt" >= ${todayStart}
      AND "targetIds" @> ${JSON.stringify(targetIds)}::jsonb
    ORDER BY "finishedAt" DESC LIMIT 1`;
  return runs[0] ?? null;
}

async function dailyPreference(input: { provider: string; workspaceId: string; targetIds: string[]; from: Date; to: Date; todayStart: Date }): Promise<ChannelRollupPreference | null> {
  const yesterdayEnd = new Date(input.todayStart.getTime() - 1);
  const rolledTo = input.to < yesterdayEnd ? input.to : yesterdayEnd;
  if (rolledTo < input.from) return null;
  if (!await coveringRun(input.provider, input.workspaceId, 'daily', input.targetIds, input.from, input.todayStart)) return null;
  const rows = await prisma.$queryRaw<Array<{ targetId: string; metric: string; period: string; value: number; asOf: Date; fetchedAt: Date }>>`
    SELECT "targetId", metric, period, value, "asOf", "fetchedAt" FROM analytics_rollup_daily
    WHERE "workspaceId" = ${input.workspaceId} AND provider = ${input.provider} AND "targetId" = ANY(${input.targetIds}::text[])
      AND day >= ${dayOf(input.from)}::date AND day <= ${dayOf(rolledTo)}::date`;
  return {
    granularity: 'daily',
    rows: rows.map(row => ({ targetId: row.targetId, metric: row.metric, period: row.period, date: row.asOf, value: row.value, fetchedAt: row.fetchedAt })),
    rolledFrom: input.from, rolledTo,
  };
}

async function weeklyPreference(input: { provider: string; workspaceId: string; targetIds: string[]; from: Date; to: Date; todayStart: Date }): Promise<ChannelRollupPreference | null> {
  const fromDay = dayOf(input.from);
  const toDay = dayOf(input.to);
  // Weeks fully inside the range render as weekly points; the partial weeks at
  // both edges keep daily points so totals stay exact.
  const fullWeeks = fullWeeksInRange(fromDay, toDay);
  if (!fullWeeks.length) return null;
  const [dailyRun, weeklyRun] = await Promise.all([
    coveringRun(input.provider, input.workspaceId, 'daily', input.targetIds, input.from, input.todayStart),
    coveringRun(input.provider, input.workspaceId, 'weekly', input.targetIds, input.from, input.todayStart),
  ]);
  if (!dailyRun || !weeklyRun) return null;
  const firstStart = fullWeeks[0]!;
  const lastEnd = new Date(new Date(`${fullWeeks[fullWeeks.length - 1]}T00:00:00.000Z`).getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
  const [weeks, edges] = await Promise.all([
    prisma.$queryRaw<Array<{ targetId: string; metric: string; period: string; weekStart: Date; value: number; fetchedAt: Date }>>`
      SELECT "targetId", metric, period, "weekStart", value, "fetchedAt" FROM analytics_rollup_weekly
      WHERE "workspaceId" = ${input.workspaceId} AND provider = ${input.provider} AND "targetId" = ANY(${input.targetIds}::text[])
        AND "weekStart" >= ${firstStart}::date AND "weekStart" <= ${fullWeeks[fullWeeks.length - 1]}::date`,
    prisma.$queryRaw<Array<{ targetId: string; metric: string; period: string; value: number; asOf: Date; fetchedAt: Date; day: Date }>>`
      SELECT "targetId", metric, period, value, "asOf", "fetchedAt", day FROM analytics_rollup_daily
      WHERE "workspaceId" = ${input.workspaceId} AND provider = ${input.provider} AND "targetId" = ANY(${input.targetIds}::text[])
        AND day >= ${fromDay}::date AND day <= ${toDay}::date AND (day < ${firstStart}::date OR day > ${lastEnd}::date)`,
  ]);
  return {
    granularity: 'weekly',
    rows: [
      ...weeks.map(row => ({ targetId: row.targetId, metric: row.metric, period: row.period, date: dayStartUtc(row.weekStart), value: row.value, fetchedAt: row.fetchedAt })),
      ...edges.map(row => ({ targetId: row.targetId, metric: row.metric, period: row.period, date: row.asOf, value: row.value, fetchedAt: row.fetchedAt })),
    ],
    rolledFrom: input.from, rolledTo: input.to,
  };
}

export { fullWeeksInRange };
