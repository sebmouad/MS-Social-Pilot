import { authenticate, setSessionCookie } from '@/lib/auth';
import { env } from '@/lib/env';
import { errors } from '@/lib/errors';
import { clear, hit } from '@/lib/rate-limit';
import { loginSchema } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';

/**
 * Sign in.
 *
 * Rate limited on two keys, because they stop different things. The address
 * bounds guessing at one account's password however many machines the guesses
 * come from. The client bounds one machine working through a list of addresses,
 * and bounds the load: checking a password is deliberately slow, so an
 * unlimited form is also a cheap way to keep every core busy.
 *
 * The client key is whatever the proxy says, which can be forged — but forging
 * it does not get past the address key, and a client honest enough to be
 * identified is the one worth slowing down.
 */
export const POST = route(async (request: Request) => {
  const { email, password } = loginSchema.parse(await readJson(request));

  const limit = { limit: env.loginAttempts, windowMs: env.loginWindowMs };
  const address = email.trim().toLowerCase();
  const client =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const addressKey = `login:address:${address}`;
  const clientKey = `login:client:${client}`;

  const attempts = [hit(addressKey, limit), hit(clientKey, limit)];
  const blocked = attempts.find((attempt) => !attempt.allowed);
  if (blocked) {
    throw errors.tooManyAttempts(Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 60_000)));
  }

  const token = await authenticate(email, password);

  // A success clears both counts. For the address it means a person who
  // mistypes their password twice and then gets it right starts from zero. For
  // the client it matters more than it looks: a whole office behind one
  // address would otherwise spend its allowance on people signing in
  // successfully, and the tenth colleague of the morning would be turned away.
  // Somebody who can sign in is not who the limit is for.
  clear(addressKey);
  clear(clientKey);

  await setSessionCookie(token);
  return ok({ ok: true });
});
