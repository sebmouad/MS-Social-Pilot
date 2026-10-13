import { requireAuth } from '@/lib/auth';
import { checkAccountHealth } from '@/lib/accounts';
import { disconnect } from '@/lib/connections';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';

type Context = { params: Promise<{ id: string }> };

// Token health carries raw platform errors and scopes: root only, like the
// connection check on /root/connections.
export const GET = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  if (!auth.isInstanceOwner) throw errors.notFound();
  const { id } = await context.params;

  // The scoping lives in the service, so this cannot be got wrong by a caller
  // that forgets to look the account up first.
  const health = await checkAccountHealth(id, auth.workspace.id);
  if (!health) throw errors.accountNotFound();

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
    throw errors.adminsOnlyDisconnect();
  }
  // Previously this reported success for an id that was never touched, which
  // is indistinguishable from a disconnection that silently did nothing.
  if (result.outcome === 'not_found') throw errors.accountNotFound();

  // Posts this could not stop on the way out. Nobody has the credentials to
  // try again now, so this is the last chance to say so.
  return ok({ ok: true, stillScheduledOnFacebook: result.stillScheduledOnFacebook });
});
