/** Week-date helpers for the Analytics rollup pipeline. Leaf module: no imports. */

const DAY_MS = 86_400_000;

/** Monday (UTC) starting the week that holds `day` (YYYY-MM-DD). */
export function weekStartOfDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - mondayOffset * DAY_MS).toISOString().slice(0, 10);
}

/** Monday starts of the weeks fully inside [fromDay, toDay] (both YYYY-MM-DD). */
export function fullWeeksInRange(fromDay: string, toDay: string): string[] {
  const from = new Date(`${fromDay}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDay}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  // First Monday on or after fromDay: fromDay is a Monday when it is its own week start.
  let monday = weekStartOfDay(fromDay) === fromDay ? from : new Date(`${weekStartOfDay(fromDay)}T00:00:00.000Z`).getTime() + 7 * DAY_MS;
  const weeks: string[] = [];
  while (monday + 6 * DAY_MS <= to) {
    weeks.push(new Date(monday).toISOString().slice(0, 10));
    monday += 7 * DAY_MS;
  }
  return weeks;
}
