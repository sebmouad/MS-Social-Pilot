'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { importPostsCsv } from '@/server/publishing/lifecycle';
import { composeErrorMessage } from '@/lib/publishing/compose-errors';

export type ImportState = { error: string } | null;

/** Import draft posts from a CSV. Problems stay on the import page; success lands on the post list. */
export async function importPostsAction(_previous: ImportState, data: FormData): Promise<ImportState> {
  let count: number;
  try {
    const viewer = await requireViewer({ feature: 'publishing/import', channelScoped: true, write: true });
    if (!canAccessFeature(viewer.permissions, 'publishing/import', 'write')) throw new Error('Only workspace managers can import batches of posts.');
    const file = data.get('csv');
    if (!(file instanceof File) || !file.size) throw new Error('Choose a CSV file to import.');
    const text = await file.text();
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }) };
    count = (await withWorkspaceOperation(viewer.workspaceId, () => importPostsCsv(actor, text))).count;
    revalidatePath('/publishing/posts');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) throw error;
    return { error: composeErrorMessage(error) };
  }
  redirect(`/publishing/posts?notice=${encodeURIComponent(`imported-${count}`)}`);
}
