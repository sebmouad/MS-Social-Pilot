import { addDaysToKey, instantToWall, wallTimeToInstant, workspaceDateKey } from '@/lib/calendar-dates';
import { selectStatusSnapshot } from '../server/wordpress-store';
import { autopilotOf, settledFailures } from '../wordpress/autopilot';
import { channelConfig, type PlanConfig } from '../wordpress/recipe';
import type { RecipePool } from './RecipeSource';

export type RecipeStatus = {
  state: 'active' | 'paused' | 'unavailable';
  lastRunAt: string | null;
  timeZone: string;
  upcoming: Array<{ slotAt: string; targetName: string; title: string }>;
  publishedToday: number;
  failed: number;
  uncertain: number;
  pool: { low: boolean; complete: boolean; pages: RecipePool['pages'] } | null;
};

type Source = { id: string; enabled: boolean; lastRunAt: string | null; config: { timezone: string; horizonDays: number; autopilot?: unknown } };

/**
 * Status for the card at the top of Feeds, read from the plan ledger. `source` and `pool` come from the authorized
 * recipe read; the snapshot only narrows to the channels the viewer may see. The slot count and the failure window
 * are the Root settings `feeds.wordpress.statusUpcomingCount` and `feeds.wordpress.statusFailureWindowDays`.
 */
export async function loadRecipeStatus(input: { workspaceId: string; source: Source; available: boolean; pool: RecipePool | null | undefined; upcomingLimit: number; failureWindowDays: number; allowedTargetIds?: readonly string[]; now?: Date }): Promise<RecipeStatus> {
  const now = input.now ?? new Date();
  const zone = input.source.config.timezone;
  const today = workspaceDateKey(now, zone);
  const start = wallTimeToInstant(today, '00:00', zone);
  const end = wallTimeToInstant(addDaysToKey(today, 1), '00:00', zone);
  const dayStart = start.ok ? start.instant : new Date(now.getTime() - 86_400_000);
  const dayEnd = end.ok ? end.instant : new Date(dayStart.getTime() + 86_400_000);
  const snapshot = await selectStatusSnapshot(input.workspaceId, input.source.id, {
    now, dayStart, dayEnd, failuresSince: new Date(now.getTime() - input.failureWindowDays * 86_400_000), upcomingLimit: input.upcomingLimit, targetIds: input.allowedTargetIds, gapMinutes: autopilotOf(input.source.config.autopilot).bestTimes.gapMinutes,
  });
  // Same rule as the autopilot's « To look at » (2026-11-24): a failed time on a channel whose day still got its full
  // count of posts was moved, not missed; the card said « 5 failed » for times the board had already settled.
  const settled = settledFailures([...snapshot.planned, ...snapshot.unresolved.filter(row => row.state === 'failed')],
    targetId => channelConfig(input.source.config as unknown as PlanConfig, targetId).slots.length, row => `${row.targetId}|${instantToWall(row.slotAt, zone).date}`);
  const left = snapshot.unresolved.filter(row => !settled.has(row.id));
  return {
    state: !input.available ? 'unavailable' : input.source.enabled ? 'active' : 'paused',
    lastRunAt: input.source.lastRunAt, timeZone: zone,
    upcoming: snapshot.upcoming.map(row => ({ slotAt: row.slotAt.toISOString(), targetName: row.targetName, title: row.title })),
    publishedToday: snapshot.publishedToday, failed: left.filter(row => row.state === 'failed').length, uncertain: left.filter(row => row.state === 'uncertain').length,
    pool: input.pool ? { low: input.pool.low, complete: input.pool.complete, pages: input.pool.pages } : null,
  };
}
