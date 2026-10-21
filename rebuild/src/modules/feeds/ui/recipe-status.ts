import { addDaysToKey, wallTimeToInstant, workspaceDateKey } from '@/lib/calendar-dates';
import { selectStatusSnapshot } from '../server/wordpress-store';
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

type Source = { id: string; enabled: boolean; lastRunAt: string | null; config: { timezone: string; horizonDays: number } };

/**
 * Status for the card at the top of Feeds, read from the plan ledger. `source` and `pool` come from the authorized
 * recipe read; the snapshot only narrows to the channels the viewer may see. Failures are counted over the source's
 * own planning horizon so the window is the configured one, not a number chosen here.
 */
export async function loadRecipeStatus(input: { workspaceId: string; source: Source; available: boolean; pool: RecipePool | null | undefined; upcomingLimit: number; allowedTargetIds?: readonly string[]; now?: Date }): Promise<RecipeStatus> {
  const now = input.now ?? new Date();
  const zone = input.source.config.timezone;
  const today = workspaceDateKey(now, zone);
  const start = wallTimeToInstant(today, '00:00', zone);
  const end = wallTimeToInstant(addDaysToKey(today, 1), '00:00', zone);
  const dayStart = start.ok ? start.instant : new Date(now.getTime() - 86_400_000);
  const dayEnd = end.ok ? end.instant : new Date(dayStart.getTime() + 86_400_000);
  const snapshot = await selectStatusSnapshot(input.workspaceId, input.source.id, {
    now, dayStart, dayEnd, failuresSince: new Date(now.getTime() - input.source.config.horizonDays * 86_400_000), upcomingLimit: input.upcomingLimit, targetIds: input.allowedTargetIds,
  });
  return {
    state: !input.available ? 'unavailable' : input.source.enabled ? 'active' : 'paused',
    lastRunAt: input.source.lastRunAt, timeZone: zone,
    upcoming: snapshot.upcoming.map(row => ({ slotAt: row.slotAt.toISOString(), targetName: row.targetName, title: row.title })),
    publishedToday: snapshot.publishedToday, failed: snapshot.unresolved.failed, uncertain: snapshot.unresolved.uncertain,
    pool: input.pool ? { low: input.pool.low, complete: input.pool.complete, pages: input.pool.pages } : null,
  };
}
