import { OperationError } from '@/lib/operation-error';
import type { PublishMedia, PublishingFormatDescriptor, PublishingMediaSupport } from '@/platforms/types';
import { validatePublishingMediaSupport } from './media-support';
export type { PublishingFormatDescriptor } from '@/platforms/types';

const invalidMetadata = () => new OperationError('unavailable', 'Publishing format options are unavailable for this destination.');

function validMediaSupport(value: unknown): value is PublishingMediaSupport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Array.isArray(item.kinds) &&
    item.kinds.every(kind => kind === 'image' || kind === 'video') && new Set(item.kinds).size === item.kinds.length &&
    (item.maxImages === null || (Number.isInteger(item.maxImages) && Number(item.maxImages) >= 0)) &&
    (item.maxVideos === null || (Number.isInteger(item.maxVideos) && Number(item.maxVideos) >= 0)) &&
    typeof item.mixedKinds === 'boolean' && typeof item.linkWithMedia === 'boolean' && typeof item.imageAltText === 'boolean' &&
    !(item.maxImages === 0 && item.kinds.includes('image')) && !(item.maxVideos === 0 && item.kinds.includes('video'));
}

function validDescriptor(value: unknown): value is PublishingFormatDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id.trim() || item.id !== item.id.trim() || item.id.length > 128 ||
      typeof item.label !== 'string' || !item.label.trim() || item.label !== item.label.trim() || item.label.length > 120 ||
      !validMediaSupport(item.media) || typeof item.firstComment !== 'boolean' ||
      typeof item.remoteStatus !== 'boolean' || typeof item.remoteDelete !== 'boolean' ||
      !item.scheduling || typeof item.scheduling !== 'object' || Array.isArray(item.scheduling)) return false;
  const scheduling = item.scheduling as Record<string, unknown>;
  if (typeof scheduling.application !== 'boolean' || typeof scheduling.native !== 'boolean') return false;
  if (scheduling.nativeLeadSeconds === undefined) return true;
  const lead = scheduling.nativeLeadSeconds as Record<string, unknown> | null;
  return Boolean(lead) && typeof lead === 'object' && Number.isSafeInteger(lead!.min) && Number.isSafeInteger(lead!.max) &&
    Number(lead!.min) >= 0 && Number(lead!.max) > Number(lead!.min);
}

/** Validate module metadata once at the host boundary; malformed declarations fail closed. */
export function validatePublishingFormatDescriptors(value: unknown): PublishingFormatDescriptor[] {
  if (!Array.isArray(value) || value.some(item => !validDescriptor(item))) throw invalidMetadata();
  const descriptors = value as PublishingFormatDescriptor[];
  if (new Set(descriptors.map(item => item.id)).size !== descriptors.length) throw invalidMetadata();
  return descriptors.map(item => ({ id: item.id, label: item.label, firstComment: item.firstComment, remoteStatus: item.remoteStatus, remoteDelete: item.remoteDelete, media: { kinds: [...item.media.kinds], maxImages: item.media.maxImages, maxVideos: item.media.maxVideos, mixedKinds: item.media.mixedKinds, linkWithMedia: item.media.linkWithMedia, imageAltText: item.media.imageAltText }, scheduling: { application: item.scheduling.application, native: item.scheduling.native, ...(item.scheduling.nativeLeadSeconds ? { nativeLeadSeconds: { min: item.scheduling.nativeLeadSeconds.min, max: item.scheduling.nativeLeadSeconds.max } } : {}) } }));
}

/** Return validated authoring choices. Missing declarations mean no format choices are available. */
export function availablePublishingFormats(value: unknown): PublishingFormatDescriptor[] {
  if (value === undefined || value === null) return [];
  return validatePublishingFormatDescriptors(value);
}

/** Resolve an explicit format and verify the requested operation; never substitute another format. */
export function validateSelectedPublishingFormat(
  descriptors: unknown,
  selectedId: unknown,
  request: {
    media: readonly Pick<PublishMedia, 'kind' | 'url' | 'altText'>[];
    link?: string | null;
    firstComment?: string | null;
    scheduled?: boolean;
  },
): PublishingFormatDescriptor {
  if (typeof selectedId !== 'string' || !selectedId.trim()) throw new OperationError('invalid_request', 'Choose a publishing format for this destination.');
  const format = validatePublishingFormatDescriptors(descriptors).find(item => item.id === selectedId);
  if (!format) throw new OperationError('invalid_request', 'The selected publishing format is unavailable for this destination. Choose an available format.');
  validatePublishingMediaSupport(request.media, request.link, format.media);
  if (request.firstComment?.trim() && !format.firstComment) throw new OperationError('invalid_request', 'This publishing format cannot add a first comment. Clear the comment or choose another format.');
  if (request.scheduled && !format.scheduling.application) throw new OperationError('invalid_request', 'This publishing format cannot be scheduled. Choose another format.');
  return format;
}
