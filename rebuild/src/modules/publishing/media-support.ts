import { catalogGroup, composerCatalogDefaults, fillComposerCopy, type ComposerCatalog } from './composer-catalog';
import { OperationError } from '@/lib/operation-error';
import type { PlatformAdapter, PublishMedia, PublishingMediaSupport } from '@/platforms/types';
export type { PublishingMediaSupport } from '@/platforms/types';

const MEDIA_KEYS = new Set(['kind', 'url', 'altText']);

/** Parse an untrusted ordered media list without accepting client identities or bytes. */
export function parsePublishingMedia(value: unknown, format: PublishingMediaIssueFormatter = defaultMediaFormatter): PublishMedia[] {
  if (!Array.isArray(value)) throw new OperationError('invalid_request', format('invalidList'));
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new OperationError('invalid_request', format('invalidAttachments'));
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some(key => !MEDIA_KEYS.has(key)) ||
      (record.kind !== 'image' && record.kind !== 'video') || typeof record.url !== 'string' ||
      (record.altText !== undefined && typeof record.altText !== 'string') ||
      (record.kind === 'video' && record.altText !== undefined)) {
      throw new OperationError('invalid_request', format('invalidAttachments'));
    }
    return {
      kind: record.kind,
      url: record.url,
      ...(typeof record.altText === 'string' ? { altText: record.altText } : {}),
    };
  });
}

export type PublishingMediaIssueKey = keyof ReturnType<typeof catalogGroup<'media'>>;
export type PublishingMediaIssueFormatter = (key: PublishingMediaIssueKey, values?: Record<string, string | number>) => string;
/** Browser-safe formatter over the same request catalog used by the composer. */
export function publishingMediaFormatter(catalog: ComposerCatalog = composerCatalogDefaults, locale: 'en' | 'fr' = 'en'): PublishingMediaIssueFormatter {
  const copy = catalogGroup(catalog, 'media', locale);
  return (key, values = {}) => fillComposerCopy(copy[key], values);
}
const defaultMediaFormatter = publishingMediaFormatter();

/** A pure, safe compatibility message usable by customer UI and server services. */
export function publishingMediaIssue(
  support: PublishingMediaSupport | undefined,
  media: readonly Pick<PublishMedia, 'kind' | 'url' | 'altText'>[],
  link?: string | null,
  format: PublishingMediaIssueFormatter = defaultMediaFormatter,
): string | null {
  if (!media.length) return null;
  if (!support) return format('unavailable');
  const images = media.filter(item => item.kind === 'image').length;
  const videos = media.filter(item => item.kind === 'video').length;
  if (images && !support.kinds.includes('image')) return format('images');
  if (videos && !support.kinds.includes('video')) return format('videos');
  if (support.maxImages !== null && images > support.maxImages) return format('maxImages', { max: support.maxImages });
  if (support.maxVideos !== null && videos > support.maxVideos) return format('maxVideos', { max: support.maxVideos });
  if (!support.mixedKinds && images > 0 && videos > 0) return format('mixed');
  if (!support.linkWithMedia && link?.trim() && media.length) return format('link');
  if (!support.imageAltText && media.some(item => item.kind === 'image' && item.altText?.trim())) return format('alt');
  return null;
}

export function validatePublishingMediaSupport(
  media: readonly Pick<PublishMedia, 'kind' | 'url' | 'altText'>[],
  link: string | null | undefined,
  support: PublishingMediaSupport | undefined,
  format: PublishingMediaIssueFormatter = defaultMediaFormatter,
): void {
  const issue = publishingMediaIssue(support, media, link, format);
  if (issue) throw new OperationError('invalid_request', issue);
}

export function assertPublishingMediaSupport(adapter: Pick<PlatformAdapter, 'publishingMedia'>, media: readonly Pick<PublishMedia, 'kind' | 'url' | 'altText'>[], link?: string | null, format: PublishingMediaIssueFormatter = defaultMediaFormatter): void {
  validatePublishingMediaSupport(media, link, adapter.publishingMedia, format);
}
