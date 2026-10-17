import { OperationError } from '@/lib/operation-error';
import type { PlatformAdapter, PublishMedia, PublishingMediaSupport } from '@/platforms/types';
export type { PublishingMediaSupport } from '@/platforms/types';

const MEDIA_KEYS = new Set(['kind', 'url', 'altText']);

/** Parse an untrusted ordered media list without accepting client identities or bytes. */
export function parsePublishingMedia(value: unknown): PublishMedia[] {
  if (!Array.isArray(value)) throw new OperationError('invalid_request', 'Choose a valid media list.');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new OperationError('invalid_request', 'Choose valid media attachments.');
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some(key => !MEDIA_KEYS.has(key)) ||
      (record.kind !== 'image' && record.kind !== 'video') || typeof record.url !== 'string' ||
      (record.altText !== undefined && typeof record.altText !== 'string') ||
      (record.kind === 'video' && record.altText !== undefined)) {
      throw new OperationError('invalid_request', 'Choose valid media attachments.');
    }
    return {
      kind: record.kind,
      url: record.url,
      ...(typeof record.altText === 'string' ? { altText: record.altText } : {}),
    };
  });
}

/** A pure, safe compatibility message usable by customer UI and server services. */
export function publishingMediaIssue(
  support: PublishingMediaSupport | undefined,
  media: readonly Pick<PublishMedia, 'kind' | 'url' | 'altText'>[],
  link?: string | null,
): string | null {
  if (!media.length) return null;
  if (!support) return 'Media publishing is unavailable for this destination.';
  const images = media.filter(item => item.kind === 'image').length;
  const videos = media.filter(item => item.kind === 'video').length;
  if (images && !support.kinds.includes('image')) return 'This destination cannot publish images.';
  if (videos && !support.kinds.includes('video')) return 'This destination cannot publish videos.';
  if (support.maxImages !== null && images > support.maxImages) return `This destination supports up to ${support.maxImages} images per post.`;
  if (support.maxVideos !== null && videos > support.maxVideos) return `This destination supports up to ${support.maxVideos} videos per post.`;
  if (!support.mixedKinds && images > 0 && videos > 0) return 'This destination cannot combine images and video in one post.';
  if (!support.linkWithMedia && link?.trim() && media.length) return 'This destination cannot combine a link with media in one post.';
  if (!support.imageAltText && media.some(item => item.kind === 'image' && item.altText?.trim())) return 'This destination does not support image descriptions.';
  return null;
}

export function validatePublishingMediaSupport(
  media: readonly Pick<PublishMedia, 'kind' | 'url' | 'altText'>[],
  link: string | null | undefined,
  support: PublishingMediaSupport | undefined,
): void {
  const issue = publishingMediaIssue(support, media, link);
  if (issue) throw new OperationError('invalid_request', issue);
}

export function assertPublishingMediaSupport(adapter: Pick<PlatformAdapter, 'publishingMedia'>, media: readonly Pick<PublishMedia, 'kind' | 'url' | 'altText'>[], link?: string | null): void {
  validatePublishingMediaSupport(media, link, adapter.publishingMedia);
}
