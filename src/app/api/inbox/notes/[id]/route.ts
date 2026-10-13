import { ok, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { canManageTeam } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { deleteInboxNote } from '@/lib/inbox-notes';

type Context = { params: Promise<{ id: string }> };

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const done = await deleteInboxNote({ workspaceId: auth.workspace.id, id, userId: auth.user.id, manager: canManageTeam(auth.role) });
  if (!done) throw errors.notFound();
  return ok({ ok: true });
});
