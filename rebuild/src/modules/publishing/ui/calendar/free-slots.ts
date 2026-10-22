export type WeeklySlot = { dayOfWeek: number; hour: number; minute: number };

/**
 * Free queue times per day for the calendar (design v2 S3): the weekly queue times that fall on a day in view, are still
 * ahead (after `nowTime` today, any time on a later day) and are not already used by a post at that exact wall-clock time.
 * Keys are workspace-local dates; `dayOfWeek` 0 is Sunday, like the stored queue times. At most `limit` times per day.
 */
export function freeQueueSlots(input: { keys: readonly string[]; today: string; nowTime: string; weekly: readonly WeeklySlot[]; taken: (key: string) => ReadonlySet<string | undefined>; limit: number }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (input.limit <= 0) return out;
  for (const key of input.keys) {
    if (key < input.today) continue;
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    const used = input.taken(key);
    const times = [...new Set(input.weekly.filter(slot => slot.dayOfWeek === weekday).map(slot => `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`))]
      .filter(time => !used.has(time) && (key > input.today || time > input.nowTime)).sort().slice(0, input.limit);
    if (times.length) out.set(key, times);
  }
  return out;
}
