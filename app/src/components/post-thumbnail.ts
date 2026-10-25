/**
 * Neutral post thumbnail resolution shared by Publishing, Home and Analytics. It reads only the
 * stored media list (or an already stored picture URL) and never branches on a provider.
 */
export type PostThumbnail = {
  /** Safe image URL, or null when only a video without a poster (or nothing displayable) exists. */
  url: string | null;
  /** The representative attachment is a video; shown with a play mark. */
  video: boolean;
  /** Number of attachments on the post. */
  count: number;
};

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Library references resolve through the authorized media route (as a small thumbnail); anything else must be a web URL. */
export function imageSource(value: unknown): string | null {
  if (typeof value === 'string' && value.startsWith('media:')) {
    const id = value.slice('media:'.length);
    return MEDIA_ID.test(id) ? `/api/media/${encodeURIComponent(id)}?w=320` : null;
  }
  return safeWebUrl(value);
}

/** First displayable image (or video poster) of a stored media list; null when the post has no media. */
export function postThumbnail(media: unknown, fallbackUrl?: string | null): PostThumbnail | null {
  const items = Array.isArray(media) ? media.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : [];
  const fallback = safeWebUrl(fallbackUrl);
  if (!items.length) return fallback ? { url: fallback, video: false, count: 1 } : null;
  let video = false;
  for (const item of items) {
    if (item.kind === 'image') {
      const url = imageSource(item.url);
      if (url) return { url, video: false, count: items.length };
    } else if (item.kind === 'video') {
      video = true;
      const poster = imageSource(item.posterUrl ?? item.thumbnailUrl);
      if (poster) return { url: poster, video: true, count: items.length };
    }
  }
  return { url: fallback, video: video && !fallback, count: items.length };
}
