import { NextResponse } from 'next/server';
import { authRateLimit, signIn } from '@/server/auth-flow';
import { hit, clear, forgive } from '@/server/rate-limit';
import { clientIp } from '@/server/client-ip';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 403 });
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
  const attempts = [hit(addressKey, limit)];
  if (clientKey) attempts.push(hit(clientKey, limit));
  const pair = pairKey ? hit(pairKey, { limit: Number.MAX_SAFE_INTEGER, windowMs: limit.windowMs }) : null;
  const blocked = attempts.find((attempt) => !attempt.allowed);
  if (blocked) return NextResponse.json({ code: 'TOO_MANY_ATTEMPTS' }, { status: 429 });
  try {
    const outcome = await signIn(email, password);
    clear(addressKey);
    if (clientKey && pairKey && pair) {
      forgive(clientKey, Number.MAX_SAFE_INTEGER - pair.remaining);
      clear(pairKey);
    }
    return NextResponse.json({ ok: true, next: outcome });
  } catch {
    return NextResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
  }
}
