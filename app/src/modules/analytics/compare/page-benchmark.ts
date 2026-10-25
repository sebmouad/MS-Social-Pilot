import { readPosts } from '@/modules/analytics/explorer-posts/service';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';

/** One selected channel over the benchmark window, from stored data only. Unknown is null, never zero. */
export type BenchmarkRow = { id: string; name: string; followers: number | null; postsPerWeek: number; avgRank: number | null; measuredPosts: number };
export type PageBenchmark = { days: number; rankLabel: string | null; rows: BenchmarkRow[]; truncated: boolean };

const DAY = 86_400_000;
export const BENCHMARK_DAYS = 28;

/** Pure: posts per week and mean ranking measure per channel; best average first, channels without measures last. */
export function benchmarkRows(channels: ReadonlyArray<{ id: string; name: string }>, followers: ReadonlyMap<string, number>, posts: ReadonlyArray<{ channelId: string; rankValue: number | null }>, days: number): BenchmarkRow[] {
  return channels.map(channel => {
    const own = posts.filter(post => post.channelId === channel.id);
    const measured = own.map(post => post.rankValue).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return {
      id: channel.id, name: channel.name, followers: followers.get(channel.id) ?? null,
      postsPerWeek: own.length / (days / 7),
      avgRank: measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null,
      measuredPosts: measured.length,
    };
  }).sort((a, b) => (b.avgRank ?? -Infinity) - (a.avgRank ?? -Infinity) || a.name.localeCompare(b.name));
}

/** Null when Analytics cannot be read for this viewer. */
export async function readPageBenchmark(actor: { userId: string; workspaceId: string; allowedChannelIds?: readonly string[] }, now = new Date()): Promise<PageBenchmark | null> {
  const day = (offset: number) => new Date(now.getTime() - offset * DAY).toISOString().slice(0, 10);
  const range = { start: day(BENCHMARK_DAYS - 1), end: day(0) };
  try {
    const [snapshot, posts] = await Promise.all([
      readAnalyticsSnapshot(actor, range, { feature: 'analytics/compare', ...(actor.allowedChannelIds ? { allowedChannelIds: actor.allowedChannelIds } : {}) }),
      readPosts(actor, range, undefined, true),
    ]);
    const channels = snapshot.options.channels.filter(channel => snapshot.selected.channelIds.includes(channel.id));
    const followers = new Map(snapshot.audience.entries.map(entry => [entry.id, entry.value]));
    const rankLabel = posts.items.find(post => post.rankValue !== null)?.rankLabel ?? null;
    return { days: BENCHMARK_DAYS, rankLabel, rows: benchmarkRows(channels, followers, posts.items, BENCHMARK_DAYS), truncated: posts.nextPage !== null };
  } catch {
    return null;
  }
}
