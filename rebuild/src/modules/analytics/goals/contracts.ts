import { z } from 'zod';
import { dayIn, zonedToUtc } from '../reports/schedule-time';

/** Stored ids are the legacy `page_goals.metric` values; customer labels stay provider-neutral. */
export const GOAL_METRICS = ['followers', 'views', 'engagements', 'posts'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
/** English labels for API, MCP and report output; screens use goals/copy.ts. */
export const GOAL_LABELS: Record<GoalMetric, string> = { followers: 'New followers', views: 'Views', engagements: 'Engagement', posts: 'Posts published' };
export const GOAL_MAX = 100_000_000;
export type GoalPace = 'met' | 'onTrack' | 'behind' | 'noData';
export const PACE_LABELS: Record<GoalPace, string> = { met: 'Reached', onTrack: 'On track', behind: 'Behind', noData: 'No data yet' };

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const goalValue = z.union([z.number().int().min(1).max(GOAL_MAX), z.null()]);
export const goalsConfirmation = (channelId: string) => `SET ANALYTICS GOALS ${channelId}`;
export const setGoalsSchema = z.object({
  channelId: id,
  goals: z.object({ followers: goalValue.optional(), views: goalValue.optional(), engagements: goalValue.optional(), posts: goalValue.optional() }).strict(),
  confirmation: z.string().max(500),
}).strict();
export const readGoalsSchema = z.object({ channelId: id.optional() }).strict();

export type GoalProgress = { metric: GoalMetric; label: string; target: number; actual: number | null; percent: number; pace: GoalPace; paceLabel: string };
/** `trackable` lists the metrics this channel's module can measure; only those may be set. */
export type ChannelGoals = { channelId: string; channelName: string; trackable: GoalMetric[]; goals: GoalProgress[] };
export type GoalMonth = { month: string; start: string; end: string; timeZone: string };

/** How far into the period `now` is, 0..1. */
export function elapsed(start: Date, end: Date, now: Date): number {
  const span = end.getTime() - start.getTime();
  return span <= 0 ? 1 : Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span));
}
/** Met once reached; on track while at least 90% of the elapsed share is done (stored measures arrive late); else behind. */
export function goalPace(target: number, actual: number | null, share: number): GoalPace {
  if (actual === null) return 'noData';
  if (actual >= target) return 'met';
  return actual >= target * share * 0.9 ? 'onTrack' : 'behind';
}
export function goalPercent(target: number, actual: number | null): number {
  return actual === null || target <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((actual / target) * 100)));
}
/** The calendar month `yyyy-MM` holding `at` in the workspace time zone. */
export function monthIn(at: Date, timeZone: string): string {
  return dayIn(at, timeZone).slice(0, 7);
}
/** A workspace-local calendar month as [start, end) instants. */
export function monthWindow(month: string, timeZone: string): { month: string; start: Date; end: Date } {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
  return { month, start: zonedToUtc(`${month}-01`, '00:00', timeZone), end: zonedToUtc(`${next}-01`, '00:00', timeZone) };
}
