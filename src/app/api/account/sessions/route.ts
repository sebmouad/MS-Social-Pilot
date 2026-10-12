import { currentSessionTokenHash, requireAuth } from '@/lib/auth';
import { signOutOtherSessions } from '@/lib/account';
import { listSessions } from '@/lib/sessions';
import { ok, route } from '@/lib/api';

/** Your signed-in browsers, this one first. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ sessions: await listSessions(auth.user.id, await currentSessionTokenHash()) });
});

/** Sign out of every browser but this one — a lost phone, a shared computer. */
export const DELETE = route(async () => {
  const auth = await requireAuth();
  const signedOut = await signOutOtherSessions(auth.user.id, await currentSessionTokenHash());
  return ok({ signedOut });
});
