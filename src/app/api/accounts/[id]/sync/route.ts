import { requireAuth } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { syncAccountTargets } from '@/lib/accounts';
import { prisma } from '@/lib/prisma';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/** Re-read Pages and Groups from Facebook and refresh the stored page tokens. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  // This rewrites the stored page tokens, so it is a connection change.
  if (!canManageAccounts(auth.role)) {
    throw errors.adminsOnlyRefresh();
  }

  const { id } = await context.params;

  const account = await prisma.socialAccount.findFirst({
    where: { id, workspaceId: auth.workspace.id },
    select: { id: true },
  });
  if (!account) throw errors.accountNotFound();

  return ok(await syncAccountTargets(account.id));
});
