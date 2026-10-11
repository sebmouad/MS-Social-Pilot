import { requireAuth } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ok, route } from '@/lib/api';

/** Revoke: the key stops working at once. Yours, or anyone's for an admin. */
export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const { count } = await prisma.apiToken.updateMany({
    where: {
      id,
      workspaceId: auth.workspace.id,
      revokedAt: null,
      ...(canManageSettings(auth.role) ? {} : { userId: auth.user.id }),
    },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw errors.notFound();
  return ok({ ok: true });
});
