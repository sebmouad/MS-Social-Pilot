import type { FeedLinkPreview, FeedMedia } from '@/components/FeedPost';
import { parseLinkPreview, parseMedia } from './json';

type JsonColumn = Parameters<typeof parseMedia>[0];

/** A post's stored attachments, as the feed card draws them. */
export function feedMediaOf(media: JsonColumn): FeedMedia[] {
  return parseMedia(media).map((item) => ({ kind: item.kind, url: item.url, alt: item.altText ?? null }));
}

/** A post's scraped link card, when one was stored. */
export function feedLinkOf(preview: JsonColumn): FeedLinkPreview | null {
  const parsed = parseLinkPreview(preview);
  return parsed
    ? {
        url: parsed.url,
        title: parsed.title,
        description: parsed.description,
        imageUrl: parsed.imageUrl,
        siteName: parsed.siteName,
      }
    : null;
}

/**
 * What a post found on the Page carries, from the one picture Facebook gives
 * for it: a video's still plays on Facebook; anything else is a photo.
 */
export function feedMediaOfPicture(pictureUrl: string | null | undefined, video: boolean): FeedMedia[] {
  if (!pictureUrl) return [];
  return [video ? { kind: 'video', poster: pictureUrl } : { kind: 'image', url: pictureUrl }];
}
