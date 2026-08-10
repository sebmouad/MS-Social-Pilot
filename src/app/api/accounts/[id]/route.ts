import { requireAuth } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { checkAccountHealth, disconnectAccount } from '@/lib/accounts';
import { prisma } from '@/lib/prisma';
import { fail, ok, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const account = await prisma.socialAccount.findFirst({
    where: { id, workspaceId: auth.workspace.id },
  });
  if (!account) return fail('Account not found.', 404);

  return ok({ health: await checkAccountHealth(account.id) });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  if (!canManageAccounts(auth.role)) {
    return fail('Only workspace owners and admins can disconnect accounts.', 403);
  }

  const { id } = await context.params;
  await disconnectAccount(auth.workspace.id, id);
  return ok({ ok: true });
});
