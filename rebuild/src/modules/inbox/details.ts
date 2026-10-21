import type { InboxSentiment } from './server/types';

export type SentimentPoint = { time: Date; sentiment: InboxSentiment | null };
export type SentimentTrend = {
  /** Oldest first, so the list reads as a timeline. */
  points: SentimentPoint[];
  counts: Record<InboxSentiment | 'unclassified', number>;
  /** unknown when fewer than two classified comments exist; never a guess. */
  direction: 'improving' | 'worsening' | 'steady' | 'unknown';
};

const SCORE: Record<InboxSentiment, number> = { negative: -1, neutral: 0, positive: 1 };

/**
 * Summarises how one person's classified comments move over time. Unclassified comments stay visible as
 * gaps and are not scored. The direction compares the older half of the classified comments with the newer half.
 */
export function sentimentTrend(points: SentimentPoint[]): SentimentTrend {
  const ordered = [...points].sort((a, b) => a.time.getTime() - b.time.getTime());
  const counts = { positive: 0, neutral: 0, negative: 0, unclassified: 0 };
  for (const point of ordered) counts[point.sentiment ?? 'unclassified'] += 1;
  const scored = ordered.flatMap(point => point.sentiment ? [SCORE[point.sentiment]] : []);
  if (scored.length < 2) return { points: ordered, counts, direction: 'unknown' };
  const half = Math.floor(scored.length / 2);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const change = mean(scored.slice(scored.length - half)) - mean(scored.slice(0, half));
  return { points: ordered, counts, direction: change > 0.25 ? 'improving' : change < -0.25 ? 'worsening' : 'steady' };
}

export type InboxContactDetails = {
  kind: 'message' | 'comment' | 'review';
  id: string;
  person: { name: string; /** The platform's id for the person; absent when the item carried none. */ remoteId: string | null };
  channel: { id: string; name: string; provider: string | null };
  /** Earliest stored item from this person on this channel; null when unknown. */
  firstSeen: Date | null;
  /** Stored messages and comments written by this person on this channel. With no platform id this is only the open item. */
  messageCount: number;
  /** False when the person has no platform id, so counts and related posts cover this item only. */
  identityKnown: boolean;
  relatedPosts: Array<{ id: string; text: string | null; comments: number; lastCommentAt: Date }>;
  relatedPostsMore: boolean;
  state: { resolved: boolean; hidden: boolean; unread: number; assignee: { id: string; name: string | null } | null };
  sentiment: SentimentTrend;
};
