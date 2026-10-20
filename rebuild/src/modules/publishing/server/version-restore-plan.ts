import { createHash } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import type { PublishMedia, PublishingFormatDescriptor } from '@/platforms/types';
import type { VersionSnapshot } from '../collaboration/ports';
import { publishingMediaIssue } from '../media-support';

export type RestoreIssue = { code: 'destinations' | 'format' | 'media' | 'comment' | 'delay'; destinationId?: string; destinationName?: string; en: string; fr: string };
export type RestoreReview = { exact: boolean; canRestore: boolean; issues: RestoreIssue[]; token: string; destinations: Array<{ id: string; name: string; formatLabel: string }>; content: { message: string; firstComment: string; firstCommentDelayMinutes: number; link: string | null; media: PublishMedia[]; targetIds: string[]; destinationFormats: Record<string, string> } };
export type RestoreOptions = { mode?: 'preview' | 'exact' | 'closest'; reviewToken?: string };
export type RestoreDestination = { id: string; name?: string; formatId: string; formats: PublishingFormatDescriptor[]; defaultId?: string; comment: boolean; mediaValid: (media: PublishMedia[], link: string | null) => boolean };

/** Deterministic adaptation: retain current destinations, restore available saved formats and ordered media.
 * No provider identities or protocol rules belong here. A token binds explicit consent to the actual proposal. */
export function planVersionRestore(snapshot: VersionSnapshot, destinations: RestoreDestination[], sourceMedia: PublishMedia[], maximumDelay: number, maximumMedia = sourceMedia.length): RestoreReview {
  if (!Number.isSafeInteger(maximumDelay) || maximumDelay < 0) throw new OperationError('unavailable', 'The first-comment delay limit is unavailable.');
  const issues: RestoreIssue[] = [];
  const ordered = [...destinations].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const targetIds = ordered.map(d => d.id);
  if (JSON.stringify([...snapshot.targetIds].sort()) !== JSON.stringify(targetIds)) issues.push({ code: 'destinations', en: 'Saved destinations cannot be replayed. The current destinations will be kept.', fr: 'Les destinations enregistrées ne peuvent pas être rétablies. Les destinations actuelles seront conservées.' });
  const destinationFormats: Record<string, string> = {};
  const formats = ordered.map(d => {
    const savedId = snapshot.destinationFormats?.[d.id] ?? (snapshot.targetIds.includes(d.id) ? snapshot.format : undefined);
    const selected = d.formats.find(f => f.id === savedId) ?? d.formats.find(f => f.id === d.formatId) ?? d.formats.find(f => f.id === d.defaultId);
    if (!selected) throw new OperationError('unavailable', 'No valid publishing format is available for a current destination.');
    destinationFormats[d.id] = selected.id;
    if (savedId !== selected.id) issues.push({ code: 'format', destinationId: d.id, destinationName: d.name, en: `The saved format cannot be replayed for this destination. Use ${selected.label}.`, fr: `Le format enregistré ne peut pas être rétabli pour cette destination. Utiliser ${selected.label}.` });
    return { destination: d, format: selected };
  });
  let firstComment = snapshot.firstComment ?? '';
  if (firstComment && formats.some(({ destination, format }) => !destination.comment || !format.firstComment)) {
    firstComment = '';
    issues.push({ code: 'comment', en: 'The first comment is unsupported by a current destination or format and will be omitted.', fr: 'Le premier commentaire est incompatible avec une destination ou un format actuel et sera omis.' });
  }
  const originalDelay = snapshot.firstCommentDelayMinutes ?? 0;
  const firstCommentDelayMinutes = firstComment && Number.isSafeInteger(originalDelay) && originalDelay >= 0 ? Math.min(originalDelay, maximumDelay) : 0;
  if (firstCommentDelayMinutes !== originalDelay) issues.push({ code: 'delay', en: `The saved first-comment delay is no longer valid. Use ${firstCommentDelayMinutes} minutes.`, fr: `Le délai du premier commentaire enregistré n’est plus valide. Utiliser ${firstCommentDelayMinutes} minutes.` });
  const media: PublishMedia[] = [];
  const accepts = (items: PublishMedia[]) => formats.every(({ destination, format }) => !publishingMediaIssue(format.media, items, snapshot.link) && destination.mediaValid(items, snapshot.link));
  for (const item of sourceMedia) {
    if (media.length >= maximumMedia) continue;
    let candidate = item;
    if (item.altText && formats.some(({ format }) => !format.media.imageAltText)) candidate = { kind: item.kind, url: item.url };
    if (candidate.altText && !accepts([...media, candidate])) candidate = { kind: candidate.kind, url: candidate.url };
    if (accepts([...media, candidate])) media.push(candidate);
  }
  if (JSON.stringify(media) !== JSON.stringify(snapshot.media)) issues.push({ code: 'media', en: 'Unavailable or incompatible media and image descriptions will be omitted; compatible attachments keep their order.', fr: 'Les médias et descriptions indisponibles ou incompatibles seront omis ; les pièces jointes compatibles conserveront leur ordre.' });
  const content = { message: snapshot.message, firstComment, firstCommentDelayMinutes, link: snapshot.link, media, targetIds, destinationFormats };
  const canRestore = Boolean(content.message.trim() || content.link?.trim() || media.length);
  const destinationSummary = formats.map(({ destination, format }) => ({ id: destination.id, name: destination.name ?? 'Not available', formatLabel: format.label }));
  const token = createHash('sha256').update(JSON.stringify({ versionId: snapshot.versionId, content, labels: snapshot.labelIds, issues, destinations: destinationSummary })).digest('hex');
  return { exact: issues.length === 0, canRestore, issues, token, destinations: destinationSummary, content };
}
