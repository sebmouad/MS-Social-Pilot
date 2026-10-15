"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { cancelScheduledPost, createPost, deletePost, importPostsCsv, publishPost, reviewPost, schedulePost, submitPostForApproval, syncPostStatus, updatePost } from '@/server/publishing/lifecycle';

const PATH = '/publishing/posts';
type ActionNotice = 'created' | 'updated' | 'deleted' | 'imported' | 'published' | 'publish-review' | 'synced' | 'failed';

export async function createPostAction(data: FormData) {
  await run(async viewer => {
    const postActor = actor(viewer);
    await createPost(postActor, { message: stringField(data, 'message'), firstComment: stringField(data, 'firstComment', true), ...attachments(data), targetIds: data.getAll('targetIds').filter((id): id is string => typeof id === 'string') });
    return 'created';
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
    await syncPostStatus(actor(viewer), stringField(data, 'postId'));
    return 'synced';
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
    notice = await withWorkspaceOperation(viewer.workspaceId, () => operation(viewer));
    revalidatePath(PATH);
    revalidatePath('/publishing/queue');
    revalidatePath('/publishing/approvals');
  } catch (error) {
    if (isRedirect(error)) throw error;
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
