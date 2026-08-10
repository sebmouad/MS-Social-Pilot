import { graphPaged, graphRequest } from './graph';
import { IG_MEDIA_FIELDS, IG_PROFILE_FIELDS } from './metrics';

/**
 * Instagram Business analytics, read through the connected Facebook Page.
 *
 * There is no separate Instagram login: a Business or Creator account linked to
 * a Page is reachable with that Page's token, which is why this lives beside
 * the Facebook client rather than in a provider of its own. Publishing to
 * Instagram is a different problem (the container/publish two-step) and is
 * deliberately not here.
 */

const MAX_MEDIA_PAGES = 5;

export interface IgAccountRef {
  igUserId: string;
  username: string;
}

interface RawLink {
  instagram_business_account?: { id?: string; username?: string };
}

/**
 * Find the Instagram account behind a Page, if there is one.
 *
 * Returns null rather than throwing when the Page has no linked account —
 * that is the normal case for most Pages, not an error.
 */
export async function findInstagramAccount(
  pageId: string,
  accessToken: string,
  options: { signal?: AbortSignal } = {},
): Promise<IgAccountRef | null> {
  const { data } = await graphRequest<RawLink>(pageId, {
    accessToken,
    signal: options.signal,
    params: { fields: 'instagram_business_account{id,username}' },
  });

  const account = data.instagram_business_account;
  if (!account?.id) return null;

  return { igUserId: account.id, username: account.username ?? account.id };
}

export interface IgProfile {
  igUserId: string;
  username: string;
  name: string | null;
  biography: string | null;
  website: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
}

/** The account object itself — counts that need no insights permission. */
export async function fetchInstagramProfile(
  igUserId: string,
  accessToken: string,
  options: { signal?: AbortSignal } = {},
): Promise<IgProfile> {
  const { data } = await graphRequest<Record<string, unknown>>(igUserId, {
    accessToken,
    signal: options.signal,
    params: { fields: IG_PROFILE_FIELDS.join(',') },
  });

  const text = (key: string): string | null =>
    typeof data[key] === 'string' ? (data[key] as string) : null;
  const number = (key: string): number | null =>
    typeof data[key] === 'number' ? (data[key] as number) : null;

  return {
    igUserId: String(data.id ?? igUserId),
    username: text('username') ?? igUserId,
    name: text('name'),
    biography: text('biography'),
    website: text('website'),
    profilePictureUrl: text('profile_picture_url'),
    followersCount: number('followers_count'),
    followsCount: number('follows_count'),
    mediaCount: number('media_count'),
  };
}

export interface IgMedia {
  remoteId: string;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  mediaUrl: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: Date;
  likeCount: number | null;
  commentsCount: number | null;
}

/** Recent media on the account, newest first. */
export async function fetchInstagramMedia(
  igUserId: string,
  accessToken: string,
  options: { since?: Date; signal?: AbortSignal } = {},
): Promise<IgMedia[]> {
  const raw = await graphPaged<Record<string, unknown>>(`${igUserId}/media`, {
    accessToken,
    maxPages: MAX_MEDIA_PAGES,
    limit: 50,
    signal: options.signal,
    params: {
      fields: IG_MEDIA_FIELDS.join(','),
      since: options.since ? Math.floor(options.since.getTime() / 1000) : undefined,
    },
  });

  return raw
    .map((entry) => {
      const stamp = typeof entry.timestamp === 'string' ? new Date(entry.timestamp) : null;
      if (!stamp || Number.isNaN(stamp.getTime())) return null;

      const text = (key: string): string | null =>
        typeof entry[key] === 'string' ? (entry[key] as string) : null;
      const number = (key: string): number | null =>
        typeof entry[key] === 'number' ? (entry[key] as number) : null;

      return {
        remoteId: String(entry.id),
        caption: text('caption'),
        mediaType: text('media_type'),
        mediaProductType: text('media_product_type'),
        mediaUrl: text('media_url'),
        permalink: text('permalink'),
        thumbnailUrl: text('thumbnail_url'),
        timestamp: stamp,
        likeCount: number('like_count'),
        commentsCount: number('comments_count'),
      } satisfies IgMedia;
    })
    .filter((media): media is IgMedia => media !== null);
}

/**
 * Demographic breakdowns Instagram will serve, and the `breakdown` value each
 * one needs.
 *
 * Unlike Facebook, Instagram refuses a demographic metric that arrives without
 * a `breakdown` parameter, so these cannot go through the plain catalogue
 * request — they are fetched one at a time by the service layer.
 */
export const IG_DEMOGRAPHIC_BREAKDOWNS: Record<string, string[]> = {
  follower_demographics: ['age', 'city', 'country', 'gender'],
  engaged_audience_demographics: ['age', 'city', 'country', 'gender'],
  reached_audience_demographics: ['age', 'city', 'country', 'gender'],
};

/**
 * Metrics Instagram serves only under `metric_type=total_value`.
 *
 * Asking for them in the ordinary time-series shape returns an error that says
 * nothing useful, so the vocabulary is recorded here rather than rediscovered
 * from a support thread every time Meta changes it.
 */
export const IG_TOTAL_VALUE_METRICS = new Set([
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
  'replies',
  'profile_links_taps',
  'views',
  'content_views',
  'follows_and_unfollows',
]);
