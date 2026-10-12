import { requireAuth } from '@/lib/auth';
import { deleteNote } from '@/lib/post-notes';
import { ok, route } from '@/lib/api';

/** Remove an internal note (H8): its author, or an editor and up. */
export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await deleteNote({ workspaceId: auth.workspace.id, pageScope: auth.pageScope, noteId: id, userId: auth.user.id, role: auth.role });
  return ok({ deleted: true });
});
