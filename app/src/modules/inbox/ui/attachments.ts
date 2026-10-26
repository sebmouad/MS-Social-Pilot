import type { InboxMetadata } from '@/platforms/types';

export type AttachmentKind = 'photo' | 'sticker' | 'gif' | 'video' | 'link' | 'other';

/** Provider attachment types folded into the few kinds a person recognises. */
export function attachmentKind(type: string | null): AttachmentKind {
  const value = (type ?? '').toLowerCase();
  if (value === 'sticker') return 'sticker';
  if (value.startsWith('animated_image')) return 'gif';
  if (value.startsWith('video')) return 'video';
  if (value === 'photo' || value === 'image') return 'photo';
  if (value === 'share' || value === 'link') return 'link';
  return 'other';
}

/** The first attachment with an https address; anything else is not shown as an image or link. */
export function firstAttachment(metadata: InboxMetadata | undefined): { kind: AttachmentKind; url: string | null } | null {
  const item = metadata?.attachments?.[0];
  if (!item) return null;
  const url = item.url && /^https:\/\//i.test(item.url) ? item.url : null;
  return { kind: attachmentKind(item.type), url };
}

export const safePermalink = (metadata: InboxMetadata | undefined) => metadata?.permalink && /^https:\/\//i.test(metadata.permalink) ? metadata.permalink : null;
