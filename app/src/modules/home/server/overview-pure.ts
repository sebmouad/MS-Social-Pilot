import { instantToWall, weekdayOfKey } from '@/lib/calendar-dates';

/** Pure arithmetic for the Home overview: no database, no provider knowledge. Unknown is null, never zero. */

export type Known = number | null;

/** Sum of the known values; null when none is known. */
export function sumKnown(values: readonly Known[]): Known {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

/** Totals over channels, plus a change that compares only channels known in both periods (equal coverage). */
export function periodTotals(pairs: ReadonlyArray<{ current: Known; previous: Known }>) {
  const current = sumKnown(pairs.map(pair => pair.current));
  const finite = (value: Known) => typeof value === 'number' && Number.isFinite(value);
  const both = pairs.filter(pair => finite(pair.current) && finite(pair.previous));
  const comparableCurrent = sumKnown(both.map(pair => pair.current)), comparablePrevious = sumKnown(both.map(pair => pair.previous));
  const change = comparableCurrent !== null && comparablePrevious !== null && comparablePrevious > 0 ? (comparableCurrent - comparablePrevious) / comparablePrevious : null;
  return { current, previous: comparablePrevious, change, covered: pairs.filter(pair => finite(pair.current)).length, comparable: both.length };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export type PerformancePost = { postId: string; publishedAt: Date | null; rankValue: Known };
export type HeatmapCell = { day: number; hour: number; value: number; posts: number };

/**
 * Weekday/hour cells in the workspace zone. Each channel's score is relative to that channel's own typical (median) post,
 * so a large page does not drown a small one; cells average the relative scores over channels equally.
 */
export function engagementHeatmap(histories: ReadonlyArray<readonly PerformancePost[]>, timeZone: string, minPosts: number): { cells: HeatmapCell[]; measuredPosts: number } {
  const perChannel: Array<Map<string, number[]>> = [];
  let measuredPosts = 0;
  for (const history of histories) {
    const seen = new Set<string>();
    const measured = history.filter(post => {
      if (seen.has(post.postId) || !post.publishedAt || !Number.isFinite(post.publishedAt.getTime()) || typeof post.rankValue !== 'number' || !Number.isFinite(post.rankValue) || post.rankValue < 0) return false;
      seen.add(post.postId); return true;
    });
    const typical = measured.length ? median(measured.map(post => post.rankValue!)) : 0;
    if (!(typical > 0)) continue;
    const cells = new Map<string, number[]>();
    for (const post of measured) {
      const wall = instantToWall(post.publishedAt!, timeZone);
      const key = `${weekdayOfKey(wall.date)}:${Number(wall.time.slice(0, 2))}`;
      cells.set(key, [...(cells.get(key) ?? []), post.rankValue! / typical]);
    }
    measuredPosts += measured.length;
    perChannel.push(cells);
  }
  if (measuredPosts < minPosts) return { cells: [], measuredPosts };
  const keys = new Set(perChannel.flatMap(cells => [...cells.keys()]));
  const cells: HeatmapCell[] = [...keys].map(key => {
    const lifts = perChannel.flatMap(channel => { const scores = channel.get(key); return scores ? [scores.reduce((sum, score) => sum + score, 0) / scores.length] : []; });
    const [day, hour] = key.split(':').map(Number) as [number, number];
    return { day, hour, value: lifts.reduce((sum, lift) => sum + lift, 0) / lifts.length, posts: perChannel.reduce((sum, channel) => sum + (channel.get(key)?.length ?? 0), 0) };
  });
  return { cells, measuredPosts };
}

export type ScheduleMode = 'app' | 'platform' | 'mixed';
/** Where a scheduled post is held, from its destinations' states: the app, the destination platform, or both. */
export function scheduleMode(statuses: readonly string[]): ScheduleMode {
  const held = statuses.filter(status => status === 'scheduled_remote').length;
  return held === 0 ? 'app' : held === statuses.length ? 'platform' : 'mixed';
}

export function snippet(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

const DAY = 86_400_000; // Fixed UTC calendar duration, not an operational setting.
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
/** Inclusive UTC day range ending today, `days` long. */
export function lastDays(now: Date, days: number) { return { start: isoDay(new Date(now.getTime() - (days - 1) * DAY)), end: isoDay(now) }; }

/** Spend per currency; rows in different currencies are never added together. */
export function spendByCurrency(rows: ReadonlyArray<{ currency: string | null; spend: number | string; date: string }>) {
  const groups = new Map<string, { currency: string | null; total: number; byDay: Map<string, number> }>();
  for (const row of rows) {
    // Decimal strings are amounts in major currency units, never minor units.
    // Reject malformed input rather than silently dropping spend or counting it as zero.
    if (typeof row.spend !== 'number' && typeof row.spend !== 'string') throw new Error('Invalid spend');
    if (typeof row.spend === 'string' && !/^[+-]?\d+(?:\.\d+)?$/.test(row.spend.trim())) throw new Error('Invalid spend');
    const spend = Number(row.spend);
    if (!Number.isFinite(spend)) throw new Error('Invalid spend');
    const date = isoDay(new Date(row.date));
    // Unknown currencies cannot safely be added together or displayed as money.
    const key = row.currency?.trim().toUpperCase();
    if (!key || !/^[A-Z]{3}$/.test(key)) throw new Error('Invalid currency');
    const group = groups.get(key) ?? { currency: key, total: 0, byDay: new Map<string, number>() };
    group.total += spend; group.byDay.set(date, (group.byDay.get(date) ?? 0) + spend);
    if (!Number.isFinite(group.total)) throw new Error('Invalid spend');
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ currency: group.currency, total: group.total, daily: [...group.byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })) }));
}
