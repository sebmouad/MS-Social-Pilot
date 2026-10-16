"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { cancelScheduledPost, createPost, deletePost, importPostsCsv, publishPost, reviewPost, schedulePost, submitPostForApproval, syncPostStatus, updatePost } from '@/server/publishing/lifecycle';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { wallTimeToInstant } from '@/lib/calendar-dates';

const PATH = '/publishing/posts';
type ActionNotice = 'created' | 'updated' | 'deleted' | 'imported' | 'published' | 'publish-review' | 'synced' | 'failed';

export type ComposerValues = {
  intent: string;
  attachmentKind: string;
  message: string;
  firstComment: string;
  link: string;
  imageUrl: string;
  videoUrl: string;
  uploadedImageRef: string;
  altText: string;
  targetIds: string[];
  scheduleDate: string;
  scheduleTime: string;
};
export type ComposerActionState = { status: 'idle' | 'error'; message?: string; saveUnconfirmed?: boolean; values: Partial<ComposerValues> };

export type PostEditActionState = { status: 'idle' | 'error'; message?: string; values: Partial<ComposerValues> };
export type PostDeleteActionState = { status: 'idle' | 'error'; message?: string; deleteRemote: boolean };

export async function updatePostWithRecoveryAction(previous: PostEditActionState, data: FormData): Promise<PostEditActionState> {
  const values = composerValues(data);
  try {
    const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, 'publishing/posts', 'write')) throw new OperationError('forbidden', 'You cannot manage posts.');
    await updatePost(actor(viewer), { postId: stringField(data, 'postId'), message: values.message, firstComment: values.firstComment, targetIds: values.targetIds, ...attachments(data) });
    refreshPublishing();
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { status: 'error', message: operationFailure(error, 'The save result could not be confirmed. Your changes are retained; check Posts before trying again.').error, values };
  }
  redirect(`${PATH}?notice=updated`);
}

export async function deletePostWithRecoveryAction(previous: PostDeleteActionState, data: FormData): Promise<PostDeleteActionState> {
  const deleteRemote = data.get('deleteRemote') === 'on';
  try {
    const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, 'publishing/posts', 'write')) throw new OperationError('forbidden', 'You cannot manage posts.');
    await deletePost(actor(viewer), stringField(data, 'postId'), deleteRemote);
    refreshPublishing();
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { status: 'error', message: operationFailure(error, 'The deletion result could not be confirmed. Check Posts and the selected platforms before trying again.').error, deleteRemote };
  }
  redirect(`${PATH}?notice=deleted`);
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
      ...attachments(data),
      targetIds: values.targetIds,
      scheduledAt,
    });
    revalidatePath(PATH);
    revalidatePath('/publishing/queue');
    revalidatePath('/publishing/approvals');
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { status: 'error', message: composerError(error), values };
  }
  redirect(`${PATH}?notice=${values.intent === 'schedule' ? 'scheduled' : 'created'}`);
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
    await createPost(postActor, { message: stringField(data, 'message'), firstComment: stringField(data, 'firstComment', true), ...attachments(data), targetIds: data.getAll('targetIds').filter((id): id is string => typeof id === 'string'), scheduledAt });
    return scheduledAt ? 'scheduled' : 'created';
  });
}

export async function updatePostAction(data: FormData) {
  await run(async viewer => {
    const postActor = actor(viewer);
    await updatePost(postActor, { postId: stringField(data, 'postId'), message: stringField(data, 'message'), firstComment: stringField(data, 'firstComment', true), ...attachments(data), targetIds: data.getAll('targetIds').filter((id): id is string => typeof id === 'string') });
    return 'updated';
  });
}

export async function deletePostAction(data: FormData) {
  await run(async viewer => {
    const remote = data.get('deleteRemote') === 'on';
    await deletePost(actor(viewer), stringField(data, 'postId'), remote);
    return 'deleted';
  });
}

export async function publishPostAction(data: FormData) {
  await run(async viewer => {
    const result = await publishPost(actor(viewer), stringField(data, 'postId'));
    return result.needsReconciliation || result.failed ? 'publish-review' : 'published';
  });
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
    intent: values('intent'), attachmentKind: values('attachmentKind'), message: values('message'), firstComment: values('firstComment'),
    link: values('link'), imageUrl: values('imageUrl'), videoUrl: values('videoUrl'), uploadedImageRef: values('uploadedImageRef'),
    altText: values('altText'), targetIds: data.getAll('targetIds').filter((item): item is string => typeof item === 'string'),
    scheduleDate: values('scheduleDate'), scheduleTime: values('scheduleTime'),
  };
}

function composerError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/permission|cannot manage posts|outside your channel access/i.test(message)) return 'You do not have permission to create posts for one or more selected destinations.';
  if (/Post text must|Write the post text/i.test(message)) return 'Write post text within the allowed character limit before saving.';
  if (/First comment must/i.test(message)) return 'Shorten the first comment to fit the allowed character limit.';
  if (/target|destination/i.test(message)) return 'Check your selected destinations and try again.';
  if (/attachment|image|media|HTTPS URL/i.test(message)) return 'Check the attachment and its description, then try again.';
  if (/schedule|publishing time|future/i.test(message)) return 'Choose a valid future time in your workspace time zone and select at least one destination.';
  if (message === 'intent') return 'Choose whether to save a draft or schedule the post.';
  return 'We could not save this post. Your details are still here; please try again.';
}
