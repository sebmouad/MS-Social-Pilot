import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { configOrDefault } from '@/server/config/config-or-default';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { analyticsPlatformIds, platformAnalytics } from '@/server/platforms/registry';
import { jobStopRequested } from '@/server/jobs/job-context';
import type { ChannelRollupRow } from '@/server/platforms/host';
import { ROLLUPS_POLICY_SCHEMA, type RollupsPolicy } from './config';
import { weekStartOfDay } from './weeks';

export type AnalyticsRollupsSummary = { workspaces: number; examined: number; written: number; skipped: number; failed: number };

const DAY_MS = 86_400_000;
const UPSERT_CHUNK = 500;
const dayStartUtc = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export type WeeklyRollupRow = {
  targetId: string; metric: string; period: string; weekStart: string;
  kind: 'flow' | 'stock'; value: number; samples: number; asOf: Date; fetchedAt: Date;
};

/** Pure: weekly aggregates derived from daily rollup rows. Flows sum; stocks keep the latest day. */
export function deriveWeeklyRollups(daily: ChannelRollupRow[]): WeeklyRollupRow[] {
  const weeks = new Map<string, WeeklyRollupRow & { latestDay: string }>();
  const ordered = [...daily].sort((a, b) => a.day.localeCompare(b.day) || a.targetId.localeCompare(b.targetId) || a.metric.localeCompare(b.metric));
  for (const row of ordered) {
    const weekStart = weekStartOfDay(row.day);
    const key = JSON.stringify([row.targetId, row.metric, row.period, weekStart]);
    const previous = weeks.get(key);
    if (!previous) {
      weeks.set(key, {
        targetId: row.targetId, metric: row.metric, period: row.period, weekStart,
        kind: row.kind, value: row.value, samples: row.samples, asOf: row.asOf, fetchedAt: row.fetchedAt, latestDay: row.day,
      });
    } else if (row.kind === 'stock') {
      if (row.day >= previous.latestDay) {
        previous.value = row.value;
        previous.asOf = row.asOf;
        previous.latestDay = row.day;
      }
      previous.samples += row.samples;
      if (row.fetchedAt > previous.fetchedAt) previous.fetchedAt = row.fetchedAt;
    } else {
      previous.value += row.value;
      previous.samples += row.samples;
      if (row.asOf > previous.asOf) previous.asOf = row.asOf;
      if (row.fetchedAt > previous.fetchedAt) previous.fetchedAt = row.fetchedAt;
    }
  }
  return [...weeks.values()].map(({ latestDay: _latest, ...row }) => row);
}

/**
 * Precompute daily and weekly channel rollups from stored insights. No provider
 * request is made: each platform maps its own stored tables to neutral daily
 * rows, and weekly rows derive from those. Suspended and purging workspaces are
 * skipped; read-time authorization still decides who may use the rows.
 */
export async function runAnalyticsRollups(now = new Date()): Promise<AnalyticsRollupsSummary> {
  const policy = await configOrDefault('analytics.rollups.policy', ROLLUPS_POLICY_SCHEMA);
  const total: AnalyticsRollupsSummary = { workspaces: 0, examined: 0, written: 0, skipped: 0, failed: 0 };
  for (const provider of await analyticsPlatformIds()) {
    if (jobStopRequested()) break;
    const host = await platformAnalytics(provider);
    if (!host?.rollups) continue;
    const targets = await prisma.$queryRaw<Array<{ id: string; workspaceId: string }>>`
      SELECT t.id, t."workspaceId" FROM targets t
      JOIN social_accounts sa ON sa.id = t."socialAccountId" AND sa."workspaceId" = t."workspaceId"
        AND sa.provider = ${provider} AND sa."invalidatedAt" IS NULL
      JOIN workspaces w ON w.id = t."workspaceId" AND w."suspendedAt" IS NULL
      WHERE t.enabled = true ORDER BY t."workspaceId" ASC, t.id ASC`;
    const byWorkspace = new Map<string, string[]>();
    for (const target of targets) {
      const list = byWorkspace.get(target.workspaceId) ?? [];
      list.push(target.id);
      byWorkspace.set(target.workspaceId, list);
    }
    for (const [workspaceId, targetIds] of byWorkspace) {
      if (jobStopRequested()) break;
      try {
        await assertWorkspaceNotPurging(workspaceId);
        const result = await rollWorkspace(provider, workspaceId, targetIds, now, policy, host.rollups.computeDaily);
        total.workspaces++;
        total.examined += result.examined;
        total.written += result.written;
        total.skipped += result.skippedTargets;
      } catch {
        total.failed++;
      }
    }
  }
  try {
    const cutoff = new Date(now.getTime() - policy.runHistoryDays * DAY_MS);
    await prisma.$executeRaw`DELETE FROM analytics_rollup_runs WHERE "finishedAt" < ${cutoff}`;
  } catch {
    // Retention never fails the run.
  }
  return total;
}

async function rollWorkspace(
  provider: string, workspaceId: string, targetIds: string[], now: Date,
  policy: RollupsPolicy, computeDaily: (input: { workspaceId: string; targetIds: readonly string[]; from: Date; to: Date }) => Promise<ChannelRollupRow[]>,
): Promise<{ examined: number; written: number; skippedTargets: number }> {
  const selected = targetIds.slice(0, policy.batchTargets);
  const skippedTargets = targetIds.length - selected.length;
  const todayStart = dayStartUtc(now);
  const oldestBackfill = new Date(todayStart.getTime() - (policy.backfillDays - 1) * DAY_MS);
  const watermarks = await prisma.$queryRaw<Array<{ targetId: string; maxDay: Date }>>`
    SELECT "targetId", MAX(day) AS "maxDay" FROM analytics_rollup_daily
    WHERE "targetId" = ANY(${selected}::text[]) GROUP BY "targetId"`;
  const watermarkById = new Map(watermarks.map(row => [row.targetId, row.maxDay]));
  const windows = selected.map(id => {
    const watermark = watermarkById.get(id);
    const watermarkStart = watermark ? dayStartUtc(watermark) : null;
    const from = watermarkStart ? new Date(watermarkStart.getTime() - (policy.dailyLookbackDays - 1) * DAY_MS) : oldestBackfill;
    return { id, from: from < oldestBackfill ? oldestBackfill : from };
  });
  const windowFrom = new Date(Math.min(...windows.map(window => window.from.getTime())));
  const startedAt = new Date();
  let rows: ChannelRollupRow[] = [];
  for (const window of windows) {
    if (jobStopRequested()) break;
    const computed = await computeDaily({ workspaceId, targetIds: [window.id], from: window.from, to: now });
    // A platform must only return rows for the channels it was asked about.
    rows = rows.concat(computed.filter(row => row.targetId === window.id && /^\d{4}-\d{2}-\d{2}$/.test(row.day)));
  }
  const txOptions = { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs };
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK);
    await prisma.$transaction(async tx => {
      for (const row of chunk) {
        await tx.$executeRaw`INSERT INTO analytics_rollup_daily (id, "workspaceId", provider, "targetId", metric, period, day, kind, value, samples, "asOf", "fetchedAt", "updatedAt")
          VALUES (${`ard_${randomUUID()}`}, ${workspaceId}, ${provider}, ${row.targetId}, ${row.metric}, ${row.period}, ${row.day}::date, ${row.kind}, ${row.value}, ${row.samples}, ${row.asOf}, ${row.fetchedAt}, NOW())
          ON CONFLICT ("targetId", metric, period, day) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value, samples = EXCLUDED.samples,
            "asOf" = EXCLUDED."asOf", "fetchedAt" = EXCLUDED."fetchedAt", "updatedAt" = NOW()`;
        written++;
      }
    }, txOptions);
  }
  const weekly = deriveWeeklyRollups(rows);
  for (let offset = 0; offset < weekly.length; offset += UPSERT_CHUNK) {
    const chunk = weekly.slice(offset, offset + UPSERT_CHUNK);
    await prisma.$transaction(async tx => {
      for (const row of chunk) {
        await tx.$executeRaw`INSERT INTO analytics_rollup_weekly (id, "workspaceId", provider, "targetId", metric, period, "weekStart", kind, value, samples, "asOf", "fetchedAt", "updatedAt")
          VALUES (${`arw_${randomUUID()}`}, ${workspaceId}, ${provider}, ${row.targetId}, ${row.metric}, ${row.period}, ${row.weekStart}::date, ${row.kind}, ${row.value}, ${row.samples}, ${row.asOf}, ${row.fetchedAt}, NOW())
          ON CONFLICT ("targetId", metric, period, "weekStart") DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value, samples = EXCLUDED.samples,
            "asOf" = EXCLUDED."asOf", "fetchedAt" = EXCLUDED."fetchedAt", "updatedAt" = NOW()`;
        written++;
      }
    }, txOptions);
  }
  const finishedAt = new Date();
  const status = skippedTargets > 0 ? 'partial' : 'completed';
  await prisma.$transaction(async tx => {
    for (const granularity of ['daily', 'weekly'] as const) {
      await tx.$executeRaw`INSERT INTO analytics_rollup_runs (id, "workspaceId", provider, granularity, "windowFrom", "windowTo", "targetIds", status, examined, written, "startedAt", "finishedAt")
        VALUES (${`arr_${randomUUID()}`}, ${workspaceId}, ${provider}, ${granularity}, ${windowFrom}, ${now}, ${JSON.stringify(selected)}::jsonb, ${status}, ${selected.length}, ${granularity === 'daily' ? rows.length : weekly.length}, ${startedAt}, ${finishedAt})`;
    }
  }, txOptions);
  return { examined: selected.length, written, skippedTargets };
}
