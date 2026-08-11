import { requireAuth } from '@/lib/auth';
import { checkAccountHealth } from '@/lib/accounts';
import { disconnect } from '@/lib/connections';
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
  const { id } = await context.params;

  const result = await disconnect({
    workspaceId: auth.workspace.id,
    role: auth.role,
    socialAccountId: id,
  });

  if (result.outcome === 'forbidden') {
    return fail('Only workspace owners and admins can disconnect accounts.', 403);
  }
  // Previously this reported success for an id that was never touched, which
  // is indistinguishable from a disconnection that silently did nothing.
  if (result.outcome === 'not_found') return fail('Account not found.', 404);

  return ok({ ok: true });
});
