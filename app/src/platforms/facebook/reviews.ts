import type { InboxReview } from '@/platforms/types';

/** Meta retired the Page ratings edge after v21.0; it is read on that version until the version itself is retired. */
export const FACEBOOK_RATINGS_GRAPH_VERSION = 'v21.0';
export const FACEBOOK_RATINGS_VERSION_RETIRES = new Date('2027-01-21T00:00:00Z');

/** The Graph version to read ratings on, or null when no version can serve them any more. */
export function ratingsReadVersion(configuredVersion: string, now: Date = new Date()): string | null {
  const major = Number(/^v(\d+)\./.exec(configuredVersion)?.[1]);
  if (Number.isFinite(major) && major < 22) return configuredVersion;
  return now < FACEBOOK_RATINGS_VERSION_RETIRES ? FACEBOOK_RATINGS_GRAPH_VERSION : null;
}

export const FACEBOOK_RATINGS_FIELDS = 'created_time,rating,recommendation_type,review_text,reviewer{id,name},open_graph_story{id}';

/**
 * Map one /ratings entry. The story id is the only stable identity, so an entry
 * without one (or without a valid date) is skipped rather than given a synthetic
 * key that would duplicate on the next sync.
 */
export function mapFacebookReview(raw: unknown): InboxReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const story = entry.open_graph_story && typeof entry.open_graph_story === 'object' ? (entry.open_graph_story as Record<string, unknown>).id : undefined;
  const createdAt = typeof entry.created_time === 'string' ? new Date(entry.created_time) : null;
  if (typeof story !== 'string' || !story || !createdAt || Number.isNaN(createdAt.getTime())) return null;
  const reviewer = entry.reviewer && typeof entry.reviewer === 'object' ? (entry.reviewer as Record<string, unknown>).name : undefined;
  const rating = typeof entry.rating === 'number' && Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 5 ? entry.rating : null;
  const recommendation = entry.recommendation_type === 'positive' || entry.recommendation_type === 'negative' ? entry.recommendation_type : null;
  return {
    id: story, createdAt, authorName: typeof reviewer === 'string' ? reviewer : null, rating, recommendation,
    text: typeof entry.review_text === 'string' && entry.review_text ? entry.review_text : null,
  };
}
