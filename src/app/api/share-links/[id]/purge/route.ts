import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ok, route } from '@/lib/api';

/** Permanently delete a client link, revoking its access in the same operation. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const { count } = await prisma.shareLink.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  if (count === 0) throw new AppError({ key: 'errors.notFound', fallback: 'Not found.', status: 404 });
  return ok({ deleted: true });
});
