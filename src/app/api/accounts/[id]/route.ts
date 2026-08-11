import { requireAuth } from '@/lib/auth';
import { checkAccountHealth } from '@/lib/accounts';
import { disconnect } from '@/lib/connections';
import { fail, ok, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  // The scoping lives in the service, so this cannot be got wrong by a caller
  // that forgets to look the account up first.
  const health = await checkAccountHealth(id, auth.workspace.id);
  if (!health) return fail('Account not found.', 404);

  return ok({ health });
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
