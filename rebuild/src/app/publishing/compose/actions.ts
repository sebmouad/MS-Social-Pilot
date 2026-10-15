'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { ComposeFollowUpError, composePost, parseAttachment, parseIntent } from '@/server/publishing/compose';
import { composeErrorMessage } from '@/lib/publishing/compose-errors';

export type ComposeState = { error: string; postId?: string; /** The post itself was saved; only the follow-up step failed. */ saved?: boolean } | null;

function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Save a post from the composer. Failures come back as state so the typed
 * values stay on screen; success redirects to the post list with a notice.
 */
export async function composePostAction(_previous: ComposeState, data: FormData): Promise<ComposeState> {
  let notice: string;
  let known: string | undefined;
  try {
    const viewer = await requireViewer({ feature: 'publishing/compose', channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, 'publishing/compose', 'write')) throw new Error('You cannot manage posts.');
    const postId = text(data, 'postId').trim() || undefined;
    known = postId;
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }) };
    const result = await withWorkspaceOperation(viewer.workspaceId, () => composePost(actor, {
      postId,
      message: text(data, 'message'),
      firstComment: text(data, 'firstComment'),
      attachment: parseAttachment(name => text(data, name)),
      targetIds: data.getAll('targetIds').filter((id): id is string => typeof id === 'string'),
      intent: parseIntent(data.get('intent')),
      scheduledLocal: text(data, 'scheduledLocal'),
      timeZone: viewer.membership.workspace.timezone,
    }));
    notice = result.notice;
    revalidatePath('/publishing/posts');
    revalidatePath('/publishing/queue');
    revalidatePath('/publishing/approvals');
    revalidatePath('/publishing/calendar');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) throw error;
    return { error: composeErrorMessage(error), postId: error instanceof ComposeFollowUpError ? error.postId : known, saved: error instanceof ComposeFollowUpError };
  }
  redirect(`/publishing/posts?notice=${encodeURIComponent(notice)}`);
}
