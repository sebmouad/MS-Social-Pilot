import { instantToWall, weekdayOfKey } from '@/lib/calendar-dates';
import type { PostPerformance } from '@/server/platforms/host';

export type BestTimePolicy = { minHistory: number; minPostsPerSlot: number; minLift: number; maxSuggestions: number };
export type BestTimeSlot = { dayOfWeek: number; hour: number; minute: number; posts: number; lift: number };
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Provider ranking stays at the module boundary. Scores are compared only with that channel's own typical post. */
export function suggestBestTimes(histories: readonly (readonly PostPerformance[])[], timeZone: string, policy: BestTimePolicy): BestTimeSlot[] {
  if (!histories.length) return [];
  const channels: Array<Map<string, { scores: number[] }>> = [];
  for (const history of histories) {
    const seen = new Set<string>();
    const measured = history.filter(post => {
      if (seen.has(post.postId)) return false;
      if (!post.publishedAt || !Number.isFinite(post.publishedAt.getTime()) || !post.measuredAt || !Number.isFinite(post.measuredAt.getTime()) ||
        typeof post.rankValue !== 'number' || !Number.isFinite(post.rankValue) || post.rankValue < 0) return false;
      seen.add(post.postId); return true;
    });
    if (measured.length < policy.minHistory) return [];
    const typical = median(measured.map(post => post.rankValue!));
    if (!(typical > 0)) return [];
    const cells = new Map<string, { scores: number[] }>();
    for (const post of measured) {
      const wall = instantToWall(post.publishedAt!, timeZone);
      const key = `${weekdayOfKey(wall.date)}:${Number(wall.time.slice(0, 2))}`;
      const cell = cells.get(key) ?? { scores: [] };
      cell.scores.push(post.rankValue! / typical); cells.set(key, cell);
    }
    channels.push(cells);
  }
  const suggestions: BestTimeSlot[] = [];
  for (const key of channels[0]!.keys()) {
    const cells = channels.map(channel => channel.get(key));
    if (cells.some(cell => !cell || cell.scores.length < policy.minPostsPerSlot)) continue;
    const lifts = cells.map(cell => cell!.scores.reduce((sum, score) => sum + score, 0) / cell!.scores.length);
    if (lifts.some(lift => !Number.isFinite(lift) || lift < policy.minLift)) continue;
    const [dayOfWeek, hour] = key.split(':').map(Number) as [number, number];
    suggestions.push({ dayOfWeek, hour, minute: 0, posts: cells.reduce((sum, cell) => sum + cell!.scores.length, 0), lift: lifts.reduce((sum, lift) => sum + lift, 0) / lifts.length });
  }
  return suggestions.sort((a, b) => b.lift - a.lift || b.posts - a.posts || a.dayOfWeek - b.dayOfWeek || a.hour - b.hour).slice(0, policy.maxSuggestions);
}
