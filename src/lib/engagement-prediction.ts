/**
 * Engagement prediction: how a draft compares with the
 * Page's own past posts, as "above / around / below this Page's usual" with
 * the reasons. Never a number: a Page's history is too small and too noisy
 * for one to be honest. Plain module, no database.
 */
import { median } from './response-time';
import type { PostFormat } from './page-analysis';

export type LengthBucket = 'short' | 'medium' | 'long';
export type HourBucket = 'night' | 'morning' | 'afternoon' | 'evening';
export type Factor = 'format' | 'length' | 'time' | 'weekday';
export type Outlook = 'above' | 'around' | 'below' | 'unknown';

export interface PastPost {
  format: PostFormat;
  length: number;
  /** Hour and weekday on the workspace's clock (0 Sunday). */
  hour: number;
  weekday: number;
  interactions: number;
}

export interface Draft {
  format: PostFormat;
  length: number;
  hour: number | null;
  weekday: number | null;
}

export interface Reason {
  factor: Factor;
  /** The draft's value for it: a format, a bucket, or a weekday number. */
  value: string;
  /** Median interactions of past posts sharing it, over the Page's median. */
  ratio: number;
  posts: number;
}

export interface Prediction {
  outlook: Outlook;
  /** Past posts it was compared with. */
  basis: number;
  reasons: Reason[];
}

/** Fewer past posts than this and nothing is said. */
export const MIN_HISTORY = 10;
/** A factor needs this many past posts sharing it to count. */
const MIN_SHARED = 3;
const ABOVE = 1.2;
const BELOW = 0.8;

export function lengthBucket(length: number): LengthBucket {
  return length < 80 ? 'short' : length < 400 ? 'medium' : 'long';
}

export function hourBucket(hour: number): HourBucket {
  return hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

export function predictEngagement(history: PastPost[], draft: Draft): Prediction {
  if (history.length < MIN_HISTORY) return { outlook: 'unknown', basis: history.length, reasons: [] };
  const usual = median(history.map((post) => post.interactions)) ?? 0;
  // A Page whose posts usually get nothing cannot be compared by ratio.
  const base = Math.max(usual, 1);

  const factors: Array<{ factor: Factor; value: string; same: (post: PastPost) => boolean }> = [
    { factor: 'format', value: draft.format, same: (post) => post.format === draft.format },
    { factor: 'length', value: lengthBucket(draft.length), same: (post) => lengthBucket(post.length) === lengthBucket(draft.length) },
  ];
  if (draft.hour !== null) {
    const bucket = hourBucket(draft.hour);
    factors.push({ factor: 'time', value: bucket, same: (post) => hourBucket(post.hour) === bucket });
  }
  if (draft.weekday !== null) {
    const weekday = draft.weekday;
    factors.push({ factor: 'weekday', value: String(weekday), same: (post) => post.weekday === weekday });
  }

  const reasons: Reason[] = [];
  for (const { factor, value, same } of factors) {
    const shared = history.filter(same);
    if (shared.length < MIN_SHARED) continue;
    const ratio = (median(shared.map((post) => post.interactions)) ?? 0) / base;
    reasons.push({ factor, value, ratio: Math.round(ratio * 100) / 100, posts: shared.length });
  }
  if (reasons.length === 0) return { outlook: 'unknown', basis: history.length, reasons };

  // Geometric mean, so one doubling and one halving cancel out.
  const combined = Math.exp(reasons.reduce((sum, reason) => sum + Math.log(Math.max(reason.ratio, 0.05)), 0) / reasons.length);
  const outlook: Outlook = combined >= ABOVE ? 'above' : combined <= BELOW ? 'below' : 'around';
  // The strongest pulls first.
  reasons.sort((a, b) => Math.abs(Math.log(Math.max(b.ratio, 0.05))) - Math.abs(Math.log(Math.max(a.ratio, 0.05))));
  return { outlook, basis: history.length, reasons };
}
