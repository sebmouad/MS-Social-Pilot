import { Locale } from '@prisma/client';

import { registerUser, setSessionCookie } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { resolveLocale } from '@/i18n/locale';
import { ok, readJson, route } from '@/lib/api';
import { clientIp } from '@/lib/client-ip';
import { errors } from '@/lib/errors';
import { hit } from '@/lib/rate-limit';
import { sendVerificationEmail } from '@/lib/email-tokens';

/**
 * Accounts one client may create per window.
 *
 * Sign-in had a limit and this had none, though it does the same slow hash and
 * also writes rows: with open registration on, one script could fill the users
 * table and keep every core busy doing it. Generous, because an agency setting
 * up a team from one office is the ordinary case; a flood is not.
 */
const SIGNUP_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };

export const POST = route(async (request: Request) => {
  const input = registerSchema.parse(await readJson(request));

  // No client key without a trusted proxy to name the client (see `clientIp`):
  // one shared "unknown" key would let a single visitor's ten sign-ups shut
  // registration for everybody — invited colleagues included — for the hour.
  const client = clientIp(request);
  const attempt = client ? hit(`register:client:${client}`, SIGNUP_LIMIT) : null;
  if (attempt && !attempt.allowed) {
    throw errors.tooManySignups(Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 60_000)));
  }

  // Start people in the language they arrived in; they can change it later.
  const locale = await resolveLocale().catch(() => Locale.en);

  // The workspace, its default queue slots and the owner's notification
  // preferences are all created by `createWorkspace`. Seeding any of them here
  // as well is what caused a duplicate-key failure on sign-up.
  const { userId, token, verified } = await registerUser({ ...input, locale });
  // A self-service sign-up proves the address before using the app (S3).
  if (!verified) await sendVerificationEmail(userId).catch((error) => console.error('[register] verification email', error));

  await setSessionCookie(token);
  return ok({ userId, verified }, 201);
});
