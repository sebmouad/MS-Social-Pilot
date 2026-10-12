import { requireAuth } from '@/lib/auth';
import { canManageOthersPosts } from '@/lib/constants';
import { AppError, errors } from '@/lib/errors';
import { assertPostInScope } from '@/lib/page-access';
import { undoSend } from '@/lib/posts';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/scheduler/runner';
import { ok, route } from '@/lib/api';

/** Undo send (H10): take back a "Publish now" while it is still held. It becomes a draft. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);
  const post = await prisma.post.findFirst({ where: { id, workspaceId: auth.workspace.id }, select: { authorId: true } });
  if (!post) throw errors.postNotFound();
  if (post.authorId !== auth.user.id && !canManageOthersPosts(auth.role)) throw errors.publishOwnOnly();

  if (!(await undoSend(auth.workspace.id, id))) {
    throw new AppError({ key: 'errors.undoTooLate', fallback: 'Too late to undo: the post is already going out.', status: 409 });
  }
  await logActivity(auth.workspace.id, 'post.undone', { postId: id }, auth.user.id);
  return ok({ ok: true });
});
