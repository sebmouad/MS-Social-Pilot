import { getPendingSession } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';
import { passkeyLoginOptions } from '@/lib/passkeys';

/** The challenge for the second step by passkey. */
export const POST = route(async () => {
  const pending = await getPendingSession();
  if (!pending || pending.pending !== 'verify') throw errors.twoStepExpired();
  return ok({ options: await passkeyLoginOptions({ userId: pending.userId, sessionId: pending.id }) });
});
