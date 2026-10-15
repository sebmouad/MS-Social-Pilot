"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { cancelScheduledPost, deletePost, publishPost, reviewPost, submitPostForApproval, syncPostStatus } from '@/server/publishing/lifecycle';

const PATH = '/publishing/posts';

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

export async function submitForApprovalAction(data: FormData) {
  await run(async viewer => { await submitPostForApproval(actor(viewer), stringField(data, 'postId')); return 'submitted'; });
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
    notice = failureNotice(error);
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
function failureNotice(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/CSV|import batch/i.test(message)) return 'failed-import';
  if (/image|media attachment/i.test(message)) return 'failed-image';
  if (/remote deletion|delete remote|reconnect this source before remote deletion|platform could not confirm/i.test(message)) return 'failed-remote-delete';
  if (/permission|cannot manage posts|outside your channel access|cannot review posts/i.test(message)) return 'failed-access';
  if (/current state|can no longer|cannot be (edited|scheduled|submitted|published)|no longer awaiting/i.test(message)) return 'failed-state';
  return 'failed';
}
