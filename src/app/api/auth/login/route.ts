import { authenticate, readTrustedDeviceCookie, setSessionCookie } from '@/lib/auth';
import { env } from '@/lib/env';
import { errors } from '@/lib/errors';
import { clear, forgive, hit } from '@/lib/rate-limit';
import { loginSchema } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';
import { clientIp } from '@/lib/client-ip';

/**
 * Sign in.
 *
 * Rate limited on two keys, because they stop different things. The address
 * bounds guessing at one account's password however many machines the guesses
 * come from. The client bounds one machine working through a list of addresses,
 * and bounds the load: checking a password is deliberately slow, so an
 * unlimited form is also a cheap way to keep every core busy.
 *
 * The client key is whatever a trusted proxy says (see `clientIp`), which a
 * visitor can still forge in some deployments — but forging it does not get
 * past the address key, and a client honest enough to be identified is the one
 * worth slowing down. With no trusted proxy there is no client key at all:
 * one shared "unknown" key would let a single visitor's wrong guesses lock
 * every other visitor out.
 */
export const POST = route(async (request: Request) => {
  const { email, password } = loginSchema.parse(await readJson(request));

  const limit = { limit: env.loginAttempts, windowMs: env.loginWindowMs };
  const address = email.trim().toLowerCase();
  const client = clientIp(request);

  const addressKey = `login:address:${address}`;
  const clientKey = client ? `login:client:${client}` : null;
  // What this client has spent on this one address, never refused on its own:
  // it only measures how much of the client's count a success may give back.
  const pairKey = client ? `login:pair:${client}:${address}` : null;

  const attempts = [hit(addressKey, limit)];
  if (clientKey) attempts.push(hit(clientKey, limit));
  const pair = pairKey
    ? hit(pairKey, { limit: Number.MAX_SAFE_INTEGER, windowMs: limit.windowMs })
    : null;
  const blocked = attempts.find((attempt) => !attempt.allowed);
  if (blocked) {
    throw errors.tooManyAttempts(Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 60_000)));
  }

  const { token, next } = await authenticate(email, password, await readTrustedDeviceCookie());

  // A success clears the address's count, so a person who mistypes their
  // password twice and then gets it right starts from zero.
  //
  // The client's gives back only what *this client* spent on *this* address:
  // its mistakes and the success itself. Clearing it outright let anybody
  // holding one working account reset their allowance at will — a few guesses
  // at other people's addresses, one good sign-in, a few more, for ever. Those
  // guesses stay counted; a whole office behind one address still does not
  // spend its allowance on colleagues signing in, or on their typos.
  clear(addressKey);
  if (clientKey && pairKey && pair) {
    forgive(clientKey, Number.MAX_SAFE_INTEGER - pair.remaining);
    clear(pairKey);
  }

  await setSessionCookie(token);
  // `next` sends the browser to the second step, or to setting one up.
  return ok({ ok: true, next });
});
