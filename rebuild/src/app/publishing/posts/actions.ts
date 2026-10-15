"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { cancelScheduledPost, createPost, deletePost, importPostsCsv, publishPost, reviewPost, schedulePost, submitPostForApproval, syncPostStatus, updatePost } from '@/server/publishing/lifecycle';

const PATH = '/publishing/posts';
type ActionNotice = 'created' | 'updated' | 'deleted' | 'imported' | 'published' | 'publish-review' | 'synced' | 'failed';

export async function createPostAction(data: FormData) {
  await run(async viewer => {
    await createPost(actor(viewer), { message: stringField(data, 'message'), firstComment: stringField(data, 'firstComment', true), targetIds: data.getAll('targetIds').filter((id): id is string => typeof id === 'string') });
    return 'created';
  });
}

export async function updatePostAction(data: FormData) {
  await run(async viewer => {
    await updatePost(actor(viewer), { postId: stringField(data, 'postId'), message: stringField(data, 'message'), firstComment: stringField(data, 'firstComment', true), targetIds: data.getAll('targetIds').filter((id): id is string => typeof id === 'string') });
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
    const viewer = await requireViewer({ feature, channelScoped: true });
    if (!canAccessFeature(viewer.permissions, feature, 'write')) throw new Error(feature.endsWith('approvals') ? 'You cannot review posts.' : 'You cannot manage posts.');
    notice = await operation(viewer);
    revalidatePath(PATH);
    revalidatePath('/publishing/queue');
    revalidatePath('/publishing/approvals');
  } catch (error) {
    if (isRedirect(error)) throw error;
  }
  redirect(`${path}?notice=${encodeURIComponent(notice)}`);
}

function actor(viewer: Awaited<ReturnType<typeof requireViewer>>) { return { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }) }; }
function stringField(data: FormData, key: string, optional = false) {
  const value = data.get(key);
  if (typeof value !== 'string') {
    if (optional) return '';
    throw new Error(`Missing ${key}.`);
  }
  return value;
}
function isRedirect(error: unknown) { return typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT'); }
