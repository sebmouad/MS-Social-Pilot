import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { authRateLimit, signIn } from '@/server/auth-flow';
import { hit, clear, forgive } from '@/server/rate-limit';
import { clientIp } from '@/server/client-ip';
import { postAuthenticationPath } from '@/server/invitation-session';

/** Wrong guesses allowed for one address from all visitors together, and for one visitor over all addresses, as multiples of the per-visitor-and-address limit. */
const ADDRESS_LIMIT_FACTOR = 10;
const CLIENT_LIMIT_FACTOR = 3;

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== requestOrigin(request)) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 320 || password.length > 200) {
    return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }
  const address = email.trim().toLowerCase();
  const client = clientIp(request);
  const limit = await authRateLimit();
  const addressKey = `rebuild-login:address:${address}`;
  const clientKey = client ? `rebuild-login:client:${client}` : null;
  const pairKey = client ? `rebuild-login:pair:${client}:${address}` : null;
  // One visitor guessing at an address is stopped at the configured limit, counted for that visitor and that address
  // together. The address on its own gets ten times that, so a stranger who knows someone's email cannot lock them out
  // with a handful of wrong guesses, while guessing spread over many addresses is still capped.
  const pair = pairKey ? hit(pairKey, limit) : null;
  const attempts = [hit(addressKey, pairKey ? { ...limit, limit: limit.limit * ADDRESS_LIMIT_FACTOR } : limit)];
  if (pair) attempts.push(pair);
  if (clientKey) attempts.push(hit(clientKey, { ...limit, limit: limit.limit * CLIENT_LIMIT_FACTOR }));
  const blocked = attempts.find((attempt) => !attempt.allowed);
  if (blocked) return NextResponse.json({ code: 'TOO_MANY_ATTEMPTS' }, { status: 429 });
  try {
    const outcome = await signIn(email, password);
    clear(addressKey);
    if (clientKey && pairKey && pair) {
      forgive(clientKey, limit.limit - pair.remaining);
      clear(pairKey);
    }
    return NextResponse.json({ ok: true, next: outcome, nextUrl: await postAuthenticationPath() });
  } catch {
    return NextResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
  }
}
