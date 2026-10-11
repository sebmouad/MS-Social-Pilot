import { z } from 'zod';

import { completePendingSession, getPendingSession, setTrustedDeviceCookie } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { env } from '@/lib/env';
import { errors } from '@/lib/errors';
import { hit } from '@/lib/rate-limit';
import { TRUSTED_DEVICE_DAYS, checkSecondStepCode, trustDevice } from '@/lib/two-step';

const schema = z.object({ code: z.string().trim().min(6).max(32), remember: z.boolean().default(false) });

/**
 * The second step at sign-in: a code from the authenticator app or a
 * recovery code. Limited per account like the password, so six digits cannot
 * be worked through.
 */
export const POST = route(async (request: Request) => {
  const pending = await getPendingSession();
  if (!pending || pending.pending !== 'verify') throw errors.twoStepExpired();
  const { code, remember } = schema.parse(await readJson(request));

  const attempt = hit(`two-step:${pending.userId}`, { limit: env.loginAttempts, windowMs: env.loginWindowMs });
  if (!attempt.allowed) {
    throw errors.tooManyAttempts(Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 60_000)));
  }

  const used = await checkSecondStepCode(pending.userId, code);
  await completePendingSession(pending.id);
  if (remember) {
    await setTrustedDeviceCookie(await trustDevice(pending.userId, request.headers.get('user-agent')), TRUSTED_DEVICE_DAYS);
  }
  return ok({ ok: true, used });
});
