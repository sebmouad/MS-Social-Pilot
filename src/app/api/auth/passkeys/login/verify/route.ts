import { z } from 'zod';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

import { completePendingSession, getPendingSession, setTrustedDeviceCookie } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';
import { checkPasskey } from '@/lib/passkeys';
import { TRUSTED_DEVICE_DAYS, trustDevice } from '@/lib/two-step';

const schema = z.object({ response: z.record(z.string(), z.unknown()), remember: z.boolean().default(false) });

/** The second step by passkey. */
export const POST = route(async (request: Request) => {
  const pending = await getPendingSession();
  if (!pending || pending.pending !== 'verify') throw errors.twoStepExpired();
  const { response, remember } = schema.parse(await readJson(request));
  await checkPasskey({
    userId: pending.userId,
    sessionId: pending.id,
    response: response as unknown as AuthenticationResponseJSON,
  });
  await completePendingSession(pending.id);
  if (remember) {
    await setTrustedDeviceCookie(await trustDevice(pending.userId, request.headers.get('user-agent')), TRUSTED_DEVICE_DAYS);
  }
  return ok({ ok: true });
});
