
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText, publishingErrorCopy, publishingErrorText, type PublishingErrorCopy } from '@/modules/publishing/error-catalog';
import { createHash } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import type { PublishMedia, PublishingFormatDescriptor } from '@/platforms/types';
import type { VersionSnapshot } from '../collaboration/ports';
import { publishingMediaIssue, publishingMediaFormatter, type PublishingMediaIssueFormatter } from '../media-support';

export type RestoreIssue = { code: 'destinations' | 'format' | 'media' | 'comment' | 'delay'; destinationId?: string; destinationName?: string; en: string; fr: string };
export type RestoreReview = { exact: boolean; canRestore: boolean; issues: RestoreIssue[]; token: string; destinations: Array<{ id: string; name: string; formatLabel: string }>; content: { message: string; firstComment: string; firstCommentDelayMinutes: number; link: string | null; media: PublishMedia[]; targetIds: string[]; destinationFormats: Record<string, string> } };
export type RestoreOptions = { mode?: 'preview' | 'exact' | 'closest'; reviewToken?: string };
export type RestoreDestination = { id: string; name?: string; formatId: string; formats: PublishingFormatDescriptor[]; defaultId?: string; comment: boolean; mediaValid: (media: PublishMedia[], link: string | null) => boolean };

/** Deterministic adaptation: retain current destinations, restore available saved formats and ordered media.
 * No provider identities or protocol rules belong here. A token binds explicit consent to the actual proposal. */
export function planVersionRestore(snapshot: VersionSnapshot, destinations: RestoreDestination[], sourceMedia: PublishMedia[], maximumDelay: number, maximumMedia = sourceMedia.length, errorText: PublishingErrorText = defaultPublishingErrorText, copy: PublishingErrorCopy = publishingErrorCopy, mediaText: PublishingMediaIssueFormatter = publishingMediaFormatter()): RestoreReview {
  if (!Number.isSafeInteger(maximumDelay) || maximumDelay < 0) throw new PublishingOperationError('unavailable', 'theFirstcommentDelayLimitIsUnavailable', {}, errorText);
  const issues: RestoreIssue[] = [];
  const en = publishingErrorText(copy, 'en');
  const fr = publishingErrorText(copy, 'fr');
  const ordered = [...destinations].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const targetIds = ordered.map(d => d.id);
  if (JSON.stringify([...snapshot.targetIds].sort()) !== JSON.stringify(targetIds)) issues.push({ code: 'destinations', en: en('restoreDestinations'), fr: fr('restoreDestinations') });
  const destinationFormats: Record<string, string> = {};
  const formats = ordered.map(d => {
    const savedId = snapshot.destinationFormats?.[d.id] ?? (snapshot.targetIds.includes(d.id) ? snapshot.format : undefined);
    const selected = d.formats.find(f => f.id === savedId) ?? d.formats.find(f => f.id === d.formatId) ?? d.formats.find(f => f.id === d.defaultId);
    if (!selected) throw new PublishingOperationError('unavailable', 'noValidPublishingFormatIsAvailableForACurrent', {}, errorText);
    destinationFormats[d.id] = selected.id;
    if (savedId !== selected.id) issues.push({ code: 'format', destinationId: d.id, destinationName: d.name, en: en('restoreFormat', { value0: selected.label }), fr: fr('restoreFormat', { value0: selected.label }) });
    return { destination: d, format: selected };
  });
  let firstComment = snapshot.firstComment ?? '';
  if (firstComment && formats.some(({ destination, format }) => !destination.comment || !format.firstComment)) {
    firstComment = '';
    issues.push({ code: 'comment', en: en('restoreComment'), fr: fr('restoreComment') });
  }
  const originalDelay = snapshot.firstCommentDelayMinutes ?? 0;
  const firstCommentDelayMinutes = firstComment && Number.isSafeInteger(originalDelay) && originalDelay >= 0 ? Math.min(originalDelay, maximumDelay) : 0;
  if (firstCommentDelayMinutes !== originalDelay) issues.push({ code: 'delay', en: en('restoreDelay', { value0: firstCommentDelayMinutes }), fr: fr('restoreDelay', { value0: firstCommentDelayMinutes }) });
  const media: PublishMedia[] = [];
  const accepts = (items: PublishMedia[]) => formats.every(({ destination, format }) => !publishingMediaIssue(format.media, items, snapshot.link, mediaText) && destination.mediaValid(items, snapshot.link));
  for (const item of sourceMedia) {
    if (media.length >= maximumMedia) continue;
    let candidate = item;
    if (item.altText && formats.some(({ format }) => !format.media.imageAltText)) candidate = { kind: item.kind, url: item.url };
    if (candidate.altText && !accepts([...media, candidate])) candidate = { kind: candidate.kind, url: candidate.url };
    if (accepts([...media, candidate])) media.push(candidate);
  }
  if (JSON.stringify(media) !== JSON.stringify(snapshot.media)) issues.push({ code: 'media', en: en('restoreMedia'), fr: fr('restoreMedia') });
  const content = { message: snapshot.message, firstComment, firstCommentDelayMinutes, link: snapshot.link, media, targetIds, destinationFormats };
  const canRestore = Boolean(content.message.trim() || content.link?.trim() || media.length);
  const destinationSummary = formats.map(({ destination, format }) => ({ id: destination.id, name: destination.name ?? en('restoreUnavailable'), formatLabel: format.label }));
  const token = createHash('sha256').update(JSON.stringify({ versionId: snapshot.versionId, content, labels: snapshot.labelIds, issues, destinations: destinationSummary })).digest('hex');
  return { exact: issues.length === 0, canRestore, issues, token, destinations: destinationSummary, content };
}
