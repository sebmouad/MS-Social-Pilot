import { requireCapability } from '@/lib/auth';
import { canModerateComments } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { errors } from '@/lib/errors';
import { mayUsePage } from '@/lib/page-access';
import { undoModerationAction } from '@/lib/moderation';
import { ok, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export const POST = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canModerateComments);
  const { id } = await context.params;

  const action = await prisma.moderationAction.findFirst({
    where: { id, workspaceId: auth.workspace.id },
    select: { targetId: true },
  });
  if (!action || !mayUsePage(auth.pageScope, action.targetId)) throw errors.notFound();

  const result = await undoModerationAction({ id, workspaceId: auth.workspace.id, userId: auth.user.id, role: auth.role });
  switch (result.outcome) {
    case 'ok':
      return ok({ undone: true });
    case 'not_found':
      throw errors.notFound();
    case 'forbidden':
      throw errors.noPermission();
    case 'not_undoable':
      throw errors.notFound();
    default:
      throw errors.undoFailed(result.error ?? '');
  }
});
