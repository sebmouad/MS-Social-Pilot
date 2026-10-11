import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ok, route } from '@/lib/api';

/** Revoke a link: it stops opening at once, everywhere it was sent. */
export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const { count } = await prisma.shareLink.updateMany({
    where: { id, workspaceId: auth.workspace.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new AppError({ key: 'errors.notFound', fallback: 'Not found.', status: 404 });
  return ok({ ok: true });
});
