import { ok, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

type Context = { params: Promise<{ id: string }> };

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const { count } = await prisma.savedView.deleteMany({ where: { id, workspaceId: auth.workspace.id, userId: auth.user.id } });
  if (count === 0) throw errors.notFound();
  return ok({ ok: true });
});
