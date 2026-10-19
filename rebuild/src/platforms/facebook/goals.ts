import { prisma } from '@/server/data';
import type { GoalMeasures } from '@/server/platforms/host';

/**
 * Facebook goal measures from stored daily Page insights, with the legacy goals definitions: audience gained is
 * follows minus unfollows, views are media views (formerly impressions), engagements are Page post engagements.
 * Meta renamed several Page metrics, so per day the first name in each list that has a value wins. Reads stored data only.
 */
const NAMES = {
  follows: ['page_daily_follows_unique', 'page_fan_adds_unique', 'page_fan_adds'],
  unfollows: ['page_daily_unfollows_unique', 'page_fan_removes_unique', 'page_fan_removes'],
  views: ['page_media_view', 'page_impressions'],
  engagements: ['page_post_engagements'],
} as const;
const ALL_NAMES = Object.values(NAMES).flat();

type Row = { metric: string; endTime: Date; numeric: number | null };

/** A daily value's endTime is the end of its day, so a window (from, to] takes the days that end inside it. Null when no day has a value. */
function total(rows: Row[], names: readonly string[], from: Date, to: Date): number | null {
  const byDay = new Map<string, { rank: number; value: number }>();
  for (const row of rows) {
    const rank = names.indexOf(row.metric);
    if (rank === -1 || row.numeric === null || !Number.isFinite(row.numeric)) continue;
    if (row.endTime.getTime() <= from.getTime() || row.endTime.getTime() > to.getTime()) continue;
    const day = row.endTime.toISOString().slice(0, 10);
    const held = byDay.get(day);
    if (!held || rank < held.rank) byDay.set(day, { rank, value: row.numeric });
  }
  return byDay.size ? Math.round([...byDay.values()].reduce((sum, day) => sum + day.value, 0)) : null;
}

export function facebookGoalMeasures(rows: Row[], window: { from: Date; to: Date }): GoalMeasures {
  const follows = total(rows, NAMES.follows, window.from, window.to);
  const unfollows = total(rows, NAMES.unfollows, window.from, window.to);
  return {
    audienceGained: follows === null && unfollows === null ? null : (follows ?? 0) - (unfollows ?? 0),
    views: total(rows, NAMES.views, window.from, window.to),
    engagements: total(rows, NAMES.engagements, window.from, window.to),
  };
}

export async function readFacebookGoalMeasures(request: { workspaceId: string; targetId: string; from: Date; to: Date }): Promise<GoalMeasures> {
  const rows = await prisma.pageInsight.findMany({
    where: { targetId: request.targetId, target: { workspaceId: request.workspaceId }, period: 'day', metric: { in: ALL_NAMES }, endTime: { gt: request.from, lte: request.to } },
    select: { metric: true, endTime: true, numeric: true },
  });
  return facebookGoalMeasures(rows, request);
}
