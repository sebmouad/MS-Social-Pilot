import type { Granularity } from "./format";

/** Palette size: more series or slices than this are grouped as "Other". Matches the eight `--chart-*` tokens. */
export const PALETTE_LIMIT = 8;

/** Longest run of steps `fillTimes` will generate; a longer span is returned as given instead of freezing the page. */
export const MAX_FILLED_STEPS = 4000;

/**
 * Every step of `granularity` between the first and last time (UTC calendar arithmetic), so a gap in the data stays
 * visible as a gap on a time axis instead of being compressed (design v2 02 §6). Times that fall between steps are
 * kept, so no value is dropped. `times` must be sorted and finite.
 */
export function fillTimes(times: number[], granularity: Granularity = "day", limit = MAX_FILLED_STEPS): number[] {
  if (times.length < 2) return times;
  const first = times[0]!;
  const last = times[times.length - 1]!;
  const next = (time: number): number => {
    const date = new Date(time);
    if (granularity === "hour") return time + 3_600_000;
    if (granularity === "day") return time + 86_400_000;
    if (granularity === "week") return time + 7 * 86_400_000;
    if (granularity === "month") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours());
    return Date.UTC(date.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
  };
  const filled = new Set<number>();
  for (let time = first; time <= last; time = next(time)) {
    filled.add(time);
    if (filled.size > limit) return times;
  }
  for (const time of times) filled.add(time);
  return [...filled].sort((a, b) => a - b);
}

/**
 * Keeps the largest `limit - 1` items and sums the rest into one "Other" item. Only for additive shares of a whole;
 * the caller decides that. Unknown values stay out of the sum and never become zero.
 */
export function groupOther<T extends { value: number | null }>(items: T[], make: (rest: T[], total: number | null) => T, limit = PALETTE_LIMIT): T[] {
  if (items.length <= limit) return items;
  const ranked = items.map((item, position) => ({ position, value: item.value })).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.position - b.position);
  const kept = new Set(ranked.slice(0, limit - 1).map(entry => entry.position));
  const rest = items.filter((_, position) => !kept.has(position));
  const known = rest.filter(item => typeof item.value === "number");
  return [...items.filter((_, position) => kept.has(position)), make(rest, known.length ? known.reduce((sum, item) => sum + item.value!, 0) : null)];
}

/** Marker shapes and dash patterns that tell series apart without color (more than two series). */
export const SERIES_SYMBOLS = ["circle", "rect", "triangle", "diamond", "roundRect", "pin", "arrow", "circle"] as const;
export const SERIES_DASHES: Array<"solid" | "dashed" | "dotted"> = ["solid", "solid", "dotted", "dashed", "solid", "dotted", "dashed", "solid"];
