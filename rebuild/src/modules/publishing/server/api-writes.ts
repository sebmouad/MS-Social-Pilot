import { PublishingOperationError } from '../error-catalog';
import { parsePublishingMedia } from '../media-support';
import { parseScheduleMode } from '../remote-scheduling';
import { parseDestinationScheduleModes } from './schedule-modes';
import { loadPublishingErrorText } from './error-copy';
import { loadPublishingMediaText } from './media-copy';
import { createPost, deletePost, updatePost } from './lifecycle';
import type { PublishingActor } from './types';

/** Transport-neutral consent and input boundary. Lifecycle owns authorization, scope, transactions and domain audit. */
async function confirmed(input: Record<string, unknown>, expected: string) {
  const text = await loadPublishingErrorText();
  if (input.confirmation !== expected) throw new PublishingOperationError('invalid_request', 'confirmationRequiredRepeatTheCallWithConfirmationExactlyValue0', { value0: expected }, text);
  return text;
}

async function content(input: Record<string, unknown>) {
  const text = await loadPublishingErrorText();
  if (typeof input.message !== 'string') throw new PublishingOperationError('invalid_request', 'addPostTextALinkOrMediaBeforeSaving', {}, text);
  if (!Array.isArray(input.targetIds) || input.targetIds.some(id => typeof id !== 'string')) throw new PublishingOperationError('invalid_request', 'chooseValidDestinationsForThisPost', {}, text);
  const hasMedia = Object.prototype.hasOwnProperty.call(input, 'media');
  const scalarMedia = ['imageUrl', 'videoUrl'].some(key => input[key] !== undefined);
  if ((hasMedia && scalarMedia) || ['imageUrl', 'videoUrl'].some(key => input[key] !== undefined && typeof input[key] !== 'string')) {
    throw new PublishingOperationError('invalid_request', 'chooseValidMediaAttachments', {}, text);
  }
  const media = parsePublishingMedia(hasMedia ? input.media : [
    ...(typeof input.imageUrl === 'string' && input.imageUrl.trim() ? [{ kind: 'image', url: input.imageUrl.trim() }] : []),
    ...(typeof input.videoUrl === 'string' && input.videoUrl.trim() ? [{ kind: 'video', url: input.videoUrl.trim() }] : []),
  ], await loadPublishingMediaText());
  return { message: input.message, targetIds: input.targetIds as string[],
    firstComment: typeof input.firstComment === 'string' ? input.firstComment : '',
    ...(input.firstCommentDelayMinutes === undefined ? {} : { firstCommentDelayMinutes: input.firstCommentDelayMinutes }),
    destinationFormats: input.destinationFormats, link: typeof input.link === 'string' ? input.link : undefined, media };
}

export async function createPublishingPost(actor: PublishingActor, input: Record<string, unknown>) {
  const text = await confirmed(input, 'CREATE POST');
  let scheduledAt: Date | undefined;
  if (input.scheduledAt !== undefined) {
    if (typeof input.scheduledAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(input.scheduledAt) || !Number.isFinite(new Date(input.scheduledAt).getTime())) {
      throw new PublishingOperationError('invalid_request', 'value0MustBeAnISODatetime', { value0: 'scheduledAt' }, text);
    }
    scheduledAt = new Date(input.scheduledAt);
  }
  const scheduleMode = parseScheduleMode(input.scheduleMode);
  const destinationScheduleModes = parseDestinationScheduleModes(input.destinationScheduleModes);
  const result = await createPost(actor, { ...await content(input),
    ...(typeof input.labelId === 'string' ? { labelId: input.labelId } : {}),
    ...(scheduledAt ? { scheduledAt } : {}), ...(scheduleMode ? { scheduleMode } : {}),
    ...(destinationScheduleModes ? { destinationScheduleModes } : {}) });
  return { ...result, status: scheduledAt ? 'scheduled' : 'draft' };
}

export async function updatePublishingPost(actor: PublishingActor, postId: string, input: Record<string, unknown>) {
  await confirmed(input, `UPDATE POST ${postId}`);
  await updatePost(actor, { postId, ...await content(input) });
  return { postId, updated: true };
}

export async function deletePublishingPost(actor: PublishingActor, postId: string, input: Record<string, unknown>) {
  const text = await loadPublishingErrorText();
  if (typeof input.deleteRemote !== 'boolean') throw new PublishingOperationError('invalid_request', 'chooseWhetherToRemoveRemotePublications', {}, text);
  await confirmed(input, `DELETE POST ${postId} ${input.deleteRemote ? 'REMOTE' : 'LOCAL'}`);
  return deletePost(actor, postId, input.deleteRemote);
}
