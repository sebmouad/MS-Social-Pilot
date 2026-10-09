import { currentSessionTokenHash, requireAuth } from '@/lib/auth';
import { signOutOtherSessions } from '@/lib/account';
import { ok, route } from '@/lib/api';

/** Sign out of every browser but this one — a lost phone, a shared computer. */
export const DELETE = route(async () => {
  const auth = await requireAuth();
  const signedOut = await signOutOtherSessions(auth.user.id, await currentSessionTokenHash());
  return ok({ signedOut });
});
