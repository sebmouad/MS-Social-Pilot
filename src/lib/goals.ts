/**
 * Monthly goals per Page, the parts the dashboard, the
 * editor and reports share. Plain module: no database.
 */

export const GOAL_METRICS = ['followers', 'views', 'engagements', 'posts'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GOAL_MAX = 100_000_000;

export type GoalPace = 'met' | 'onTrack' | 'behind' | 'noData';

/** How far into the month `now` is, from 0 to 1. */
export function monthElapsed(start: Date, end: Date, now: Date): number {
  const span = end.getTime() - start.getTime();
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span));
}

/**
 * Where a goal stands: met once reached; on track while the month's share
 * done so far is at least 90% of the share of the month gone (Meta's figures
 * arrive a day or two late); behind otherwise.
 */
export function goalPace(target: number, actual: number | null, elapsed: number): GoalPace {
  if (actual === null) return 'noData';
  if (actual >= target) return 'met';
  return actual >= target * elapsed * 0.9 ? 'onTrack' : 'behind';
}

/** Progress as a whole percentage, capped at 100 for the bar. */
export function goalPercent(target: number, actual: number | null): number {
  if (actual === null || target <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((actual / target) * 100)));
}
