import { requireAuth } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { checkWorkspace } from '@/lib/health';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/**
 * Run the live connection checks and report what Facebook says.
 *
 * A POST because it is not free: it calls Graph once per app, per account and
 * per destination, so it happens when somebody asks rather than on every render
 * of the connections screen.
 *
 * Restricted to the people who could act on the answer. It names every Page the
 * workspace reaches and the state of every permission behind them, which is
 * more than a contributor drafting posts needs to see.
 */
export const POST = route(async () => {
  const auth = await requireAuth();
  if (!canManageAccounts(auth.role)) {
    throw errors.adminsOnlyHealthCheck();
  }

  return ok(await checkWorkspace(auth.workspace.id));
});
