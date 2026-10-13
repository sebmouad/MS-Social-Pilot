import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { errors } from './errors';
import { GOAL_MAX, GOAL_METRICS, goalPace, monthElapsed, type GoalMetric, type GoalPace } from './goals';
import { loadPagePosts, loadPageTotals } from './page-analysis-data';
import { targetScope, type PageScope } from './page-access';
import { prisma } from './prisma';
import { formatInZone, localInputToUtc } from './time';

/**
 * Monthly goals per Page: a target for followers gained,
 * views, engagement and posts, and how the month is going against it.
 *
 * Progress is read from what the worker already stored (Page insights and
 * posts); nothing here calls Facebook.
 */

const goalValue = z.union([z.number().int().min(1).max(GOAL_MAX), z.null()]);

export const goalsSchema = z.object({
  targetId: z.string().min(1),
  goals: z.object({
    followers: goalValue.optional(),
    views: goalValue.optional(),
    engagements: goalValue.optional(),
    posts: goalValue.optional(),
  }),
});

/** Days of views, newest name first: Meta renamed impressions to media views. */
const VIEW_METRICS = ['page_media_view', 'page_impressions'];

export interface GoalProgress {
  metric: GoalMetric;
  target: number;
  actual: number | null;
  pace: GoalPace;
}

export interface PageGoals {
  targetId: string;
  name: string;
  month: string;
  goals: GoalProgress[];
}

/** The month holding `at`, in the workspace's time zone: its first instant and the next month's. */
export function monthWindow(at: Date, timeZone: string): { month: string; start: Date; end: Date } {
  const month = formatInZone(at, timeZone, 'yyyy-MM');
  const [year, number] = month.split('-').map(Number) as [number, number];
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
  return { month, start: localInputToUtc(`${month}-01T00:00`, timeZone), end: localInputToUtc(`${next}-01T00:00`, timeZone) };
}

async function viewsIn(targetId: string, from: Date, to: Date): Promise<number | null> {
  const rows = await prisma.pageInsight.findMany({
    where: { targetId, period: 'day', metric: { in: VIEW_METRICS }, endTime: { gt: from, lte: to } },
    select: { metric: true, endTime: true, numeric: true },
  });
  // Each day once, from the newest name that has it.
  const byDay = new Map<string, { rank: number; value: number }>();
  for (const row of rows) {
    if (row.numeric === null) continue;
    const rank = VIEW_METRICS.indexOf(row.metric);
    const day = row.endTime.toISOString().slice(0, 10);
    const held = byDay.get(day);
    if (!held || rank < held.rank) byDay.set(day, { rank, value: row.numeric });
  }
  return byDay.size === 0 ? null : Math.round([...byDay.values()].reduce((sum, day) => sum + day.value, 0));
}

async function actualsFor(targetId: string, from: Date, to: Date): Promise<Record<GoalMetric, number | null>> {
  const [[totals], views, posts] = await Promise.all([
    loadPageTotals(targetId, [{ from, to }]),
    viewsIn(targetId, from, to),
    loadPagePosts(targetId, from, to),
  ]);
  const followers = totals!.follows === null && totals!.unfollows === null ? null : (totals!.follows ?? 0) - (totals!.unfollows ?? 0);
  return { followers, views, engagements: totals!.engagements, posts: posts.length };
}

/**
 * The goals of the Pages given, for the month holding `at`, with each one's
 * progress so far. Pages without goals are left out.
 */
export async function readGoals(options: {
  workspaceId: string;
  targetIds: string[];
  timeZone: string;
  at?: Date;
  now?: Date;
}): Promise<PageGoals[]> {
  const now = options.now ?? new Date();
  const { month, start, end } = monthWindow(options.at ?? now, options.timeZone);
  const rows = await prisma.pageGoal.findMany({
    where: { workspaceId: options.workspaceId, targetId: { in: options.targetIds } },
    select: { targetId: true, metric: true, target: true, page: { select: { name: true } } },
    orderBy: [{ page: { name: 'asc' } }],
  });
  if (rows.length === 0) return [];

  // A past month is judged whole; the current one up to now.
  const until = now < end ? now : end;
  const elapsed = monthElapsed(start, end, until);
  const byPage = new Map<string, typeof rows>();
  for (const row of rows) byPage.set(row.targetId, [...(byPage.get(row.targetId) ?? []), row]);

  return Promise.all(
    [...byPage].map(async ([targetId, goals]) => {
      const actuals = await actualsFor(targetId, start, until);
      return {
        targetId,
        name: goals[0]!.page.name,
        month,
        goals: GOAL_METRICS.flatMap((metric) => {
          const goal = goals.find((entry) => entry.metric === metric);
          if (!goal) return [];
          const actual = actuals[metric];
          return [{ metric, target: goal.target, actual, pace: goalPace(goal.target, actual, elapsed) }];
        }),
      };
    }),
  );
}

/** A Page's targets as stored, for the editor. */
export async function goalsOf(workspaceId: string, scope: PageScope, targetId: string): Promise<Partial<Record<GoalMetric, number>>> {
  const page = await prisma.target.findFirst({ where: { AND: [{ id: targetId, workspaceId }, targetScope(scope)] }, select: { id: true } });
  if (!page) throw errors.notFound();
  const rows = await prisma.pageGoal.findMany({ where: { targetId }, select: { metric: true, target: true } });
  return Object.fromEntries(rows.map((row) => [row.metric, row.target]));
}

/** Set or clear a Page's monthly targets; a metric left out is unchanged, null removes it. */
export async function saveGoals(workspaceId: string, scope: PageScope, input: z.infer<typeof goalsSchema>): Promise<void> {
  const page = await prisma.target.findFirst({ where: { AND: [{ id: input.targetId, workspaceId }, targetScope(scope)] }, select: { id: true } });
  if (!page) throw errors.notFound();
  await prisma.$transaction(
    GOAL_METRICS.flatMap((metric): Prisma.PrismaPromise<unknown>[] => {
      const value = input.goals[metric];
      if (value === undefined) return [];
      if (value === null) return [prisma.pageGoal.deleteMany({ where: { targetId: page.id, metric } })];
      return [
        prisma.pageGoal.upsert({
          where: { targetId_metric: { targetId: page.id, metric } },
          create: { workspaceId, targetId: page.id, metric, target: value },
          update: { target: value },
        }),
      ];
    }),
  );
}
