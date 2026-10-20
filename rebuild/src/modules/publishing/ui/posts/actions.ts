"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { cancelScheduledPost, createPost, deletePost, importPostsCsv, publishPost, reviewPost, schedulePost, submitPostForApproval, syncPostStatus, updatePost } from '@/modules/publishing/server/lifecycle';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { wallTimeToInstant } from '@/lib/calendar-dates';
import { recordFirstCommentOutcome, sendFirstComment } from '@/modules/publishing/server/first-comment';
import { finishPostDeletion, getPostDeletion, recordPostDeletionOutcome, type PostDeletionReceipt } from '@/modules/publishing/server/deletion';
import { parsePublishingMedia } from '@/modules/publishing/media-support';
import { parseFirstCommentDelay } from '@/modules/publishing/first-comment-delay';
import { runtimeConfig } from '@/server/config/store';

const PATH = '/publishing/posts';
type ActionNotice = 'created' | 'updated' | 'deleted' | 'imported' | 'published' | 'publish-review' | 'synced' | 'failed';

export type FirstCommentActionState = { status: 'idle' | 'error' | 'success'; message?: string; postId: string; postTargetId: string; state?: 'sent' | 'needs_review' | 'ready' | 'scheduled'; outcome?: 'sent' | 'not_sent'; remoteId?: string };

export type ComposerValues = {
  intent: string;
  attachmentKind: string;
  mediaJson: string;
  destinationFormatsJson: string;
  message: string;
  firstComment: string;
  firstCommentDelayMinutes: string;
  labelId: string;
  link: string;
  imageUrl: string;
  videoUrl: string;
  uploadedImageRef: string;
  altText: string;
  targetIds: string[];
  scheduleDate: string;
  scheduleTime: string;
};
export type ComposerActionState = { message?: string; saveUnconfirmed?: boolean; values: Partial<ComposerValues> } & ({ status: 'idle' | 'error'; destination?: never } | { status: 'success'; destination: string });

export type PostEditActionState = { status: 'idle' | 'error'; message?: string; values: Partial<ComposerValues> };
export type PostDeleteActionState = { status: 'idle' | 'error'; message?: string; deleteRemote: boolean; receipt?: PostDeletionReceipt; operationId?: string };

export async function updatePostWithRecoveryAction(previous: PostEditActionState, data: FormData): Promise<PostEditActionState> {
  const values = composerValues(data);
  try {
    const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, 'publishing/posts', 'write')) throw new OperationError('forbidden', 'You cannot manage posts.');
    const firstCommentDelayMinutes = await parsedCommentDelay(values.firstCommentDelayMinutes, data.has('firstCommentDelayMinutes'));
    await updatePost(actor(viewer), { postId: stringField(data, 'postId'), message: values.message, firstComment: values.firstComment, ...(firstCommentDelayMinutes === undefined ? {} : { firstCommentDelayMinutes }), targetIds: values.targetIds, ...attachments(data) });
    refreshPublishing();
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { status: 'error', message: operationFailure(error, 'The save result could not be confirmed. Your changes are retained; check Posts before trying again.').error, values };
  }
  redirect(`${PATH}?notice=updated`);
}

export async function deletePostWithRecoveryAction(previous: PostDeleteActionState, data: FormData): Promise<PostDeleteActionState> {
  const postId = stringField(data, 'postId', true);
  const intent = stringField(data, 'intent', true);
  const deleteRemote = data.get('deleteRemote') === 'on';
  try {
    if (!postId) throw new OperationError('invalid_request', 'postId is required.');
    const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: intent !== 'status' });
    if (!canAccessFeature(viewer.permissions, 'publishing/posts', intent === 'status' ? 'read' : 'write')) throw new OperationError('forbidden', 'You cannot manage posts.');
    let receipt: PostDeletionReceipt;
    if (intent === 'start') {
      if (stringField(data, 'confirmation') !== `DELETE POST ${postId} ${deleteRemote ? 'REMOTE' : 'LOCAL'}`) throw new OperationError('invalid_request', 'Confirm the requested post deletion.');
      receipt = await deletePost(actor(viewer), postId, deleteRemote);
    } else if (intent === 'status') {
      receipt = await getPostDeletion(actor(viewer), { postId });
    } else if (intent === 'finish') {
      if (stringField(data, 'confirmation') !== `FINISH POST DELETION ${postId}`) throw new OperationError('invalid_request', 'Confirm local removal after remote deletion.');
      receipt = await finishPostDeletion(actor(viewer), { postId, confirmation: `FINISH POST DELETION ${postId}` });
    } else if (intent === 'record') {
      const operationId = stringField(data, 'operationId');
      const outcome = stringField(data, 'outcome');
      if (outcome !== 'deleted' && outcome !== 'not_deleted') throw new OperationError('invalid_request', 'Choose the verified platform outcome.');
      const confirmation = `RECORD POST DELETION ${operationId} ${outcome === 'deleted' ? 'DELETED' : 'NOT DELETED'}`;
      if (stringField(data, 'confirmation') !== confirmation || data.get('verifiedOnPlatform') !== 'on') throw new OperationError('invalid_request', 'Confirm the externally checked platform outcome.');
      receipt = await recordPostDeletionOutcome(actor(viewer), { postId, operationId, outcome, confirmation, verifiedOnPlatform: true });
    } else throw new OperationError('invalid_request', 'Choose a post deletion recovery action.');
    if (!receipt || receipt.ok !== true || receipt.postId !== postId || !Array.isArray(receipt.operations) || typeof receipt.localConfirmed !== 'boolean') throw new OperationError('conflict', 'The deletion outcome could not be confirmed. Check its current status.');
    if (receipt.localConfirmed) {
      refreshPublishing();
      redirect(`${PATH}?notice=deleted`);
    }
    return { status: intent === 'start' ? 'error' : 'idle', message: deletionReceiptMessage(receipt), deleteRemote, receipt, operationId: typeof data.get('operationId') === 'string' ? String(data.get('operationId')) : undefined };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { status: 'error', message: operationFailure(error, 'The deletion result could not be confirmed. Check its current status before trying again.').error, deleteRemote, ...(previous.receipt ? { receipt: previous.receipt } : {}), operationId: typeof data.get('operationId') === 'string' ? String(data.get('operationId')) : undefined };
  }
}

function deletionReceiptMessage(receipt: PostDeletionReceipt): string {
  if (receipt.state === 'none') return 'No active deletion request is recorded. Choose the deletion request you want to start.';
  if (receipt.state === 'local_pending') return 'Remote deletion is confirmed. Finish local removal when all destination confirmations are saved.';
  if (receipt.state === 'needs_review') return 'A destination deletion result needs review. Check the platform before recording an outcome or trying a new request.';
  if (receipt.state === 'completed') return 'The post was removed locally.';
  if (receipt.operations.some(operation => operation.state === 'rejected')) return 'A destination refused the deletion request. Check its platform state before making a separate new request.';
  return 'The deletion is still in progress. Check its status before taking another action.';
}

function refreshPublishing() {
  for (const path of [PATH, '/publishing/calendar', '/publishing/queue', '/publishing/approvals']) revalidatePath(path);
}

/** Stateful creation path for the dedicated composer. The legacy redirecting action remains available to existing callers. */
export async function createPostWithRecoveryAction(previous: ComposerActionState, data: FormData): Promise<ComposerActionState> {
  const values = composerValues(data);
  try {
    const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, 'publishing/posts', 'write')) throw new Error('permission');
    if (values.intent !== 'draft' && values.intent !== 'schedule') throw new Error('intent');
    const scheduledAt = values.intent === 'schedule' ? (() => {
      const result = wallTimeToInstant(values.scheduleDate, values.scheduleTime, viewer.membership.workspace.timezone);
      if (!result.ok) throw new Error('schedule');
      return result.instant;
    })() : undefined;
    await createPost(actor(viewer), {
      message: values.message,
      firstComment: values.firstComment,
      firstCommentDelayMinutes: await parsedCommentDelay(values.firstCommentDelayMinutes),
      labelId: values.labelId || null,
      ...attachments(data),
      targetIds: values.targetIds,
      scheduledAt,
    });
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { status: 'error', message: composerError(error), values };
  }
  // Cache refresh failure cannot turn a committed write into a retryable save.
  try { refreshPublishing(); } catch { console.error('Publishing view refresh failed after a confirmed post save.'); }
  // Acknowledge the committed write independently of Next's redirect Flight stream.
  // The stateful composer navigates only after this result reaches the client.
  return { status: 'success', destination: `${PATH}?notice=${values.intent === 'schedule' ? 'scheduled' : 'created'}`, values };
}

export async function createPostAction(data: FormData) {
  await run(async viewer => {
    const postActor = actor(viewer);
    const intent = stringField(data, 'intent', true);
    if (intent && intent !== 'draft' && intent !== 'schedule') throw new Error('Choose a valid post action.');
    const scheduledAt = intent === 'schedule' ? (() => {
      const result = wallTimeToInstant(stringField(data, 'scheduleDate'), stringField(data, 'scheduleTime'), viewer.membership.workspace.timezone);
      if (!result.ok) throw new Error('Choose a valid publishing time in your workspace time zone.');
      return result.instant;
    })() : undefined;
    await createPost(postActor, { message: stringField(data, 'message'), firstComment: stringField(data, 'firstComment', true), firstCommentDelayMinutes: await parsedCommentDelay(stringField(data, 'firstCommentDelayMinutes', true)), ...attachments(data), targetIds: data.getAll('targetIds').filter((id): id is string => typeof id === 'string'), scheduledAt });
    return scheduledAt ? 'scheduled' : 'created';
  });
}

export async function updatePostAction(data: FormData) {
  await run(async viewer => {
    const postActor = actor(viewer);
    const delay = data.has('firstCommentDelayMinutes') ? await parsedCommentDelay(stringField(data, 'firstCommentDelayMinutes', true)) : undefined;
    await updatePost(postActor, { postId: stringField(data, 'postId'), message: stringField(data, 'message'), firstComment: stringField(data, 'firstComment', true), ...(delay === undefined ? {} : { firstCommentDelayMinutes: delay }), ...attachments(data), targetIds: data.getAll('targetIds').filter((id): id is string => typeof id === 'string') });
    return 'updated';
  });
}

export async function deletePostAction(data: FormData) {
  await run(async viewer => {
    const remote = data.get('deleteRemote') === 'on';
    const postId = stringField(data, 'postId');
    const receipt = await deletePost(actor(viewer), postId, remote);
    if (!receipt || receipt.ok !== true || receipt.postId !== postId || receipt.localConfirmed !== true) throw new OperationError('conflict', 'The post was not confirmed removed locally. Check deletion status before taking another action.');
    return 'deleted';
  });
}

export async function publishPostAction(data: FormData) {
  await run(async viewer => {
    const result = await publishPost(actor(viewer), stringField(data, 'postId'), undefined, data.get('retryOnly') === '1' ? { retryOnly: true } : {});
    return result.needsReconciliation || result.failed || result.firstCommentsNeedingReview || result.firstCommentsNotSent ? 'publish-review' : 'published';
  });
}

/** Send only the saved first comment for a confirmed remote post. */
export async function sendFirstCommentAction(previous: FirstCommentActionState, data: FormData): Promise<FirstCommentActionState> {
  const postId = stringField(data, 'postId');
  const postTargetId = stringField(data, 'postTargetId');
  try {
    if (stringField(data, 'confirmation') !== `SEND FIRST COMMENT ${postTargetId}`) throw new OperationError('invalid_request', 'Confirm sending this first comment.');
    if (data.get('acknowledged') !== 'on') throw new OperationError('invalid_request', 'Acknowledge the possible delayed result before sending.');
    const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, 'publishing/posts', 'write')) throw new OperationError('forbidden', 'You cannot manage posts.');
    const result = await sendFirstComment(actor(viewer), { postId, postTargetId });
    refreshPublishing();
    if (!result || result.ok !== true || result.postId !== postId || result.postTargetId !== postTargetId || !['sent', 'needs_review', 'ready', 'scheduled'].includes(result.state)) {
      return { status: 'error', postId, postTargetId, state: 'needs_review', message: 'The send result could not be confirmed. Check the platform and current post before another action.' };
    }
    if (result.state !== 'sent') return { status: 'error', postId, postTargetId, state: result.state, message: result.state === 'needs_review' ? 'The comment result is uncertain. Check the platform before recording an outcome or sending again.' : result.state === 'scheduled' ? 'The saved delay has not passed yet. You can send it now or wait until its scheduled time.' : 'The platform refused this request. Close this dialog and use Retry failed first comment for a separately confirmed retry.' };
    return { status: 'success', postId, postTargetId, state: 'sent', message: 'The first comment was recorded as sent.' };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { status: 'error', postId, postTargetId, message: operationFailure(error, 'The comment result could not be confirmed. Check its current state before taking another action.').error };
  }
}

/** Record a manual platform check; this does not query or verify the provider. */
export async function recordFirstCommentOutcomeAction(previous: FirstCommentActionState, data: FormData): Promise<FirstCommentActionState> {
  const postId = stringField(data, 'postId');
  const postTargetId = stringField(data, 'postTargetId');
  const outcome = stringField(data, 'outcome');
  const remoteId = stringField(data, 'remoteId', true).trim();
  try {
    if (outcome !== 'sent' && outcome !== 'not_sent') throw new OperationError('invalid_request', 'Choose the result you verified on the platform.');
    const confirmation = `RECORD FIRST COMMENT ${postTargetId} ${outcome === 'sent' ? 'SENT' : 'NOT SENT'}`;
    if (stringField(data, 'confirmation') !== confirmation) throw new OperationError('invalid_request', 'Confirm the verified comment result.');
    if (data.get('acknowledged') !== 'on') throw new OperationError('invalid_request', 'Acknowledge the external verification and possible late result.');
    if (outcome === 'sent' && !remoteId) throw new OperationError('invalid_request', 'Enter the platform comment ID you verified.');
    const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, 'publishing/posts', 'write')) throw new OperationError('forbidden', 'You cannot manage posts.');
    const result = await recordFirstCommentOutcome(actor(viewer), { postId, postTargetId, outcome, ...(remoteId ? { remoteId } : {}), confirmation });
    refreshPublishing();
    const expectedState = outcome === 'sent' ? 'sent' : 'ready';
    if (!result || result.ok !== true || result.postId !== postId || result.postTargetId !== postTargetId || result.state !== expectedState) {
      return { status: 'error', postId, postTargetId, state: 'needs_review', outcome, remoteId, message: 'The outcome could not be confirmed. Check the current post before repeating or taking another action.' };
    }
    return { status: 'success', postId, postTargetId, state: expectedState, outcome, remoteId, message: outcome === 'sent' ? 'The externally verified comment ID was recorded.' : 'The result was recorded as not sent. You can now make a separate send request.' };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { status: 'error', postId, postTargetId, outcome: outcome === 'sent' || outcome === 'not_sent' ? outcome : undefined, remoteId, message: operationFailure(error, 'The result could not be recorded. Check the current state before trying again.').error };
  }
}

export async function syncPostAction(data: FormData) {
  await run(async viewer => {
    const result = await syncPostStatus(actor(viewer), stringField(data, 'postId'));
    return result.synced > 0 ? 'synced' : 'failed-sync';
  });
}

export async function importPostsAction(data: FormData) {
  await run(async viewer => {
    const file = data.get('csv');
    if (!(file instanceof File) || !file.size) throw new Error('Choose a CSV file.');
    const result = await importPostsCsv(actor(viewer), await file.text());
    return `imported-${result.count}` as ActionNotice;
  });
}

export async function submitForApprovalAction(data: FormData) {
  await run(async viewer => { await submitPostForApproval(actor(viewer), stringField(data, 'postId')); return 'submitted'; });
}

export async function schedulePostAction(data: FormData) {
  await run(async viewer => {
    const value = stringField(data, 'scheduledAt');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid publishing time.');
    await schedulePost(actor(viewer), stringField(data, 'postId'), date);
    return 'scheduled';
  });
}

export async function cancelScheduledPostAction(data: FormData) {
  await run(async viewer => { await cancelScheduledPost(actor(viewer), stringField(data, 'postId')); return 'cancelled'; });
}

export async function reviewPostAction(data: FormData) {
  await run(async viewer => {
    if (!canAccessFeature(viewer.permissions, 'publishing/approvals', 'write')) throw new Error('You cannot review posts.');
    const decision = stringField(data, 'decision');
    if (decision !== 'approve' && decision !== 'reject') throw new Error('Choose an approval decision.');
    await reviewPost(actor(viewer), stringField(data, 'postId'), decision);
    return decision === 'approve' ? 'approved' : 'rejected';
  }, 'publishing/approvals', '/publishing/approvals');
}

async function run(operation: (viewer: Awaited<ReturnType<typeof requireViewer>>) => Promise<string>, feature: 'publishing/posts' | 'publishing/approvals' = 'publishing/posts', path = PATH) {
  let notice: string = 'failed';
  try {
    const viewer = await requireViewer({ feature, channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, feature, 'write')) throw new Error(feature.endsWith('approvals') ? 'You cannot review posts.' : 'You cannot manage posts.');
    notice = await operation(viewer);
    revalidatePath(PATH);
    revalidatePath('/publishing/queue');
    revalidatePath('/publishing/approvals');
  } catch (error) {
    if (isRedirect(error)) throw error;
    notice = failureNotice(error);
  }
  redirect(`${path}?notice=${encodeURIComponent(notice)}`);
}

function actor(viewer: Awaited<ReturnType<typeof requireViewer>>) { return { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }) }; }
function attachments(data: FormData) {
  const result = mediaAttachments(data);
  const raw = data.get('destinationFormatsJson');
  if (raw === null || raw === '') return result;
  if (typeof raw !== 'string') throw new OperationError('invalid_request', 'Choose valid destination formats.');
  try { return { ...result, destinationFormats: JSON.parse(raw) as unknown }; }
  catch { throw new OperationError('invalid_request', 'Choose valid destination formats.'); }
}
function mediaAttachments(data: FormData) {
  if (data.has('mediaJson')) {
    const raw = stringField(data, 'mediaJson');
    const legacyMedia = ['imageUrl', 'videoUrl', 'uploadedImageRef', 'existingImageRef', 'altText', 'existingAltText']
      .some(key => stringField(data, key, true).trim());
    if (legacyMedia) throw new OperationError('invalid_request', 'Submit either the ordered media list or the older attachment fields, not both.');
    return { link: stringField(data, 'link', true).trim(), media: parsePublishingMedia(JSON.parse(raw)) };
  }
  const image = stringField(data, 'imageUrl', true).trim();
  const video = stringField(data, 'videoUrl', true).trim();
  const link = stringField(data, 'link', true).trim();
  const existing = stringField(data, 'existingImageRef', true).trim();
  const uploaded = stringField(data, 'uploadedImageRef', true).trim();
  const removeExistingImage = data.get('removeExistingImage') === 'on';
  if (uploaded && image) throw new Error('Choose an uploaded image or an image URL, not both.');
  if (uploaded && video || image && video || link && (uploaded || image || video)) throw new Error('Choose a link, an image, or a video for this post.');
  let imageReference = image || uploaded;
  if (uploaded && !/^media:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploaded)) throw new Error('The uploaded image could not be attached. Please choose it again.');
  if (!imageReference && !video && !link) {
    if (!removeExistingImage && /^media:[0-9a-f-]{36}$/i.test(existing)) imageReference = existing;
  } else if (!imageReference) {
    imageReference = '';
  }
  const altText = (data.has('altText') ? stringField(data, 'altText', true) : stringField(data, 'existingAltText', true)).trim();
  return { link, media: [...(imageReference ? [{ kind: 'image' as const, url: imageReference, ...(altText ? { altText } : {}) }] : []), ...(video ? [{ kind: 'video' as const, url: video }] : [])] };
}
function stringField(data: FormData, key: string, optional = false) {
  const value = data.get(key);
  if (typeof value !== 'string') {
    if (optional) return '';
    throw new Error(`Missing ${key}.`);
  }
  return value;
}
function isRedirect(error: unknown) { return typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT'); }
function failureNotice(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/CSV|import batch/i.test(message)) return 'failed-import';
  if (/image|media attachment/i.test(message)) return 'failed-image';
  if (/remote deletion|delete remote|reconnect this source before remote deletion|platform could not confirm/i.test(message)) return 'failed-remote-delete';
  if (/permission|cannot manage posts|outside your channel access|cannot review posts/i.test(message)) return 'failed-access';
  if (/current state|can no longer|cannot be (edited|scheduled|submitted|published)|no longer awaiting/i.test(message)) return 'failed-state';
  return 'failed';
}

function composerValues(data: FormData): ComposerValues {
  const values = (key: string) => { const value = data.get(key); return typeof value === 'string' ? value : ''; };
  return {
    intent: values('intent'), attachmentKind: values('attachmentKind'), mediaJson: values('mediaJson'), destinationFormatsJson: values('destinationFormatsJson'), message: values('message'), firstComment: values('firstComment'), firstCommentDelayMinutes: values('firstCommentDelayMinutes') || '0',
    link: values('link'), imageUrl: values('imageUrl'), videoUrl: values('videoUrl'), uploadedImageRef: values('uploadedImageRef'),
    altText: values('altText'), targetIds: data.getAll('targetIds').filter((item): item is string => typeof item === 'string'),
    scheduleDate: values('scheduleDate'), scheduleTime: values('scheduleTime'), labelId: values('labelId'),
  };
}

async function parsedCommentDelay(value: string, present = true): Promise<number | undefined> {
  if (!present) return undefined;
  return parseFirstCommentDelay(value, Number(await runtimeConfig('publishing.maxFirstCommentDelayMinutes')));
}

function composerError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/permission|cannot manage posts|outside your channel access/i.test(message)) return 'You do not have permission to create posts for one or more selected destinations.';
  if (message === 'Add post text, a link, or media before saving.') return message;
  if (/Post text must|Write the post text/i.test(message)) return 'Shorten the post text to fit the allowed character limit.';
  if (/First comment must/i.test(message)) return 'Shorten the first comment to fit the allowed character limit.';
  if (/publishing format|destination formats/i.test(message)) return 'Choose an available format for each selected destination.';
  if (/target|destination/i.test(message)) return 'Check your selected destinations and try again.';
  if (/attachment|image|media|HTTPS URL/i.test(message)) return 'Check the attachment and its description, then try again.';
  if (/schedule|publishing time|future/i.test(message)) return 'Choose a valid future time in your workspace time zone and select at least one destination.';
  if (message === 'intent') return 'Choose whether to save a draft or schedule the post.';
  return 'We could not save this post. Your details are still here; please try again.';
}
