import { readPosts } from '@/modules/analytics/explorer-posts/service';

/** A recent organic post that clearly outperforms the workspace's typical post, from stored measures only. */
export type BoostSuggestion = { postId: string; text: string; url: string | null; channelName: string; rankLabel: string; value: number; median: number; ratio: number };

const DAY = 86_400_000;
const LOOKBACK_DAYS = 14;
const RECENT_DAYS = 7;
const MIN_POSTS = 5;
const MIN_RATIO = 2;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Pure choice: the best post published in the recent window, if it is at least MIN_RATIO times the median of the lookback. */
export function chooseBoostCandidate(posts: ReadonlyArray<{ postId: string; text: string; url: string | null; channelName: string; rankLabel: string; rankValue: number | null; publishedAt: Date | null }>, now: Date): BoostSuggestion | null {
  const measured = posts.filter((post): post is typeof post & { rankValue: number; publishedAt: Date } => typeof post.rankValue === 'number' && Number.isFinite(post.rankValue) && post.publishedAt !== null);
  if (measured.length < MIN_POSTS) return null;
  const typical = median(measured.map(post => post.rankValue));
  if (typical <= 0) return null;
  const recent = measured.filter(post => now.getTime() - post.publishedAt.getTime() <= RECENT_DAYS * DAY);
  const best = recent.reduce<(typeof recent)[number] | null>((top, post) => !top || post.rankValue > top.rankValue ? post : top, null);
  if (!best || best.rankValue < typical * MIN_RATIO) return null;
  return { postId: best.postId, text: best.text, url: best.url, channelName: best.channelName, rankLabel: best.rankLabel, value: best.rankValue, median: typical, ratio: best.rankValue / typical };
}

/** Null when there is no clear candidate or post analytics are unavailable to this viewer; never a placeholder. */
export async function readBoostSuggestion(actor: { userId: string; workspaceId: string; allowedChannelIds?: readonly string[] }, now = new Date()): Promise<BoostSuggestion | null> {
  const day = (offset: number) => new Date(now.getTime() - offset * DAY).toISOString().slice(0, 10);
  try {
    const data = await readPosts(actor, { start: day(LOOKBACK_DAYS - 1), end: day(0) }, undefined, true);
    return chooseBoostCandidate(data.items, now);
  } catch {
    return null;
  }
}
