import { prisma } from '@/server/data';
import type { GoalBasis, GoalMeasures } from '@/server/platforms/host';
import { readFacebookPostCohort, type FacebookPostCohort } from './destination-measures';

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

const VIEW_KEYS = ['post_media_view', 'impressions'] as const;
const ENGAGEMENT_KEYS = ['reactions', 'comments', 'shares'] as const;
const stored = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/**
 * Views and engagements of the posts published in the window, from their stored lifetime snapshots. This is a post cohort,
 * not daily Page flow: it covers only those posts and counts each post's whole life so far. A figure no post stored is null.
 */
export function facebookPostCohortMeasures(cohort: FacebookPostCohort): { views: number | null; engagements: number | null } {
  let views: number | null = null;
  let engagements: number | null = null;
  for (const raw of cohort.insights) {
    const insights = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const view = VIEW_KEYS.map(key => stored(insights[key])).find(value => value !== null) ?? null;
    if (view !== null) views = (views ?? 0) + view;
    const parts = ENGAGEMENT_KEYS.map(key => stored(insights[key]));
    if (parts.some(part => part !== null)) engagements = (engagements ?? 0) + parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
  }
  return { views, engagements };
}

/**
 * Page daily flows win per measure. Only a measure the Page insights lack is taken from the post cohort, and `basis` says so;
 * the two are never added together. Audience gained has no post equivalent and stays unknown.
 */
export async function facebookGoalMeasuresWithBasis(page: GoalMeasures, cohort: () => Promise<FacebookPostCohort>): Promise<GoalMeasures> {
  const basis: { views: GoalBasis | null; engagements: GoalBasis | null } = { views: page.views === null ? null : 'page-daily', engagements: page.engagements === null ? null : 'page-daily' };
  if (page.views !== null && page.engagements !== null) return { ...page, basis };
  const posts = await cohort();
  const measured = facebookPostCohortMeasures(posts);
  const result: GoalMeasures = { ...page, basis };
  if (page.views === null && measured.views !== null) { result.views = measured.views; basis.views = 'post-cohort'; }
  if (page.engagements === null && measured.engagements !== null) { result.engagements = measured.engagements; basis.engagements = 'post-cohort'; }
  if (basis.views === 'post-cohort' || basis.engagements === 'post-cohort') result.cohort = { posts: posts.posts, truncated: posts.truncated };
  return result;
}

export async function readFacebookGoalMeasures(request: { workspaceId: string; targetId: string; from: Date; to: Date }): Promise<GoalMeasures> {
  const rows = await prisma.pageInsight.findMany({
    where: { targetId: request.targetId, target: { workspaceId: request.workspaceId }, period: 'day', metric: { in: ALL_NAMES }, endTime: { gt: request.from, lte: request.to } },
    select: { metric: true, endTime: true, numeric: true },
  });
  return facebookGoalMeasuresWithBasis(facebookGoalMeasures(rows, request), () => readFacebookPostCohort(request));
}
