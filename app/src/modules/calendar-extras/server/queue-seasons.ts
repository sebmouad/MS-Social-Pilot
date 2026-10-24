import { OperationError } from '@/lib/operation-error';
import { adjustDaySlots } from './seasons';
import { settings } from './settings';
import type { Season } from '../contracts';

type Reader = { $queryRaw: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T> };
export type DaySlot = { dayOfWeek: number; hour: number; minute: number };
export type SeasonAdjuster = (daySlots: readonly DaySlot[], day: string) => DaySlot[];

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The workspace's seasonal rules that overlap [from, to], read inside the caller's queue-allocation transaction (the workspace
 * id is the only scope, like the saved queue timetable itself). Only NEW queue times are shaped by seasons; scheduled posts are never moved.
 * A set larger than the Root row limit is refused instead of applied partially.
 */
export async function queueSeasons(tx: Reader, workspaceId: string, from: Date, to: Date): Promise<Season[]> {
 const { policy, copy } = await settings('en');
 const rows = await tx.$queryRaw<Season[]>`SELECT id, name, "startsOn", "endsOn", "targetIds", rule, "shiftMinutes", "extraTimes" FROM seasonal_modes WHERE "workspaceId" = ${workspaceId} AND "startsOn" <= ${dayKey(to)} AND "endsOn" >= ${dayKey(from)} ORDER BY "startsOn", id LIMIT ${policy.maxRows + 1}`;
 if (!Array.isArray(rows)) return [];
 if (rows.length > policy.maxRows) throw new OperationError('invalid_request', copy.tooMany);
 return rows;
}

/** Per-day slot shaping for the queue allocator: pause/shift/fewer/more by the seasons active on that local day for these channels. */
export function seasonAdjuster(seasons: readonly Season[], targetIds: readonly string[]): SeasonAdjuster | undefined {
 if (!seasons.length) return undefined;
 return (daySlots, day) => {
  const dayOfWeek = new Date(`${day}T00:00:00Z`).getUTCDay();
  return adjustDaySlots(daySlots.map(s => ({ hour: s.hour, minute: s.minute })), [...seasons], targetIds, day).map(t => ({ dayOfWeek, ...t }));
 };
}
