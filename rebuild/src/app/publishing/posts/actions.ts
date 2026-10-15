"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { hasPlatformCapability } from '@/server/entitlements';
import { createPost, deletePost, importPostsCsv, publishPost, syncPostStatus, updatePost } from '@/server/publishing/lifecycle';

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
    if (remote) requireFacebook(viewer);
    await deletePost(actor(viewer), stringField(data, 'postId'), remote);
    return 'deleted';
  });
}

export async function publishPostAction(data: FormData) {
  await run(async viewer => {
    requireFacebook(viewer);
    const result = await publishPost(actor(viewer), stringField(data, 'postId'));
    return result.needsReconciliation || result.failed ? 'publish-review' : 'published';
  });
}

export async function syncPostAction(data: FormData) {
  await run(async viewer => {
    requireFacebook(viewer);
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

async function run(operation: (viewer: Awaited<ReturnType<typeof requireViewer>>) => Promise<ActionNotice>) {
  let notice: string = 'failed';
  try {
    const viewer = await requireViewer({ feature: 'publishing/posts' });
    if (!canAccessFeature(viewer.permissions, 'publishing/posts', 'write')) throw new Error('You cannot manage posts.');
    notice = await operation(viewer);
    revalidatePath(PATH);
  } catch (error) {
    if (isRedirect(error)) throw error;
  }
  redirect(`${PATH}?notice=${encodeURIComponent(notice)}`);
}

function actor(viewer: Awaited<ReturnType<typeof requireViewer>>) { return { userId: viewer.user.id, workspaceId: viewer.workspaceId }; }
function requireFacebook(viewer: Awaited<ReturnType<typeof requireViewer>>) {
  if (!hasPlatformCapability(viewer.entitlements, 'facebook')) throw new Error('Facebook publishing is not enabled for this workspace plan.');
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
