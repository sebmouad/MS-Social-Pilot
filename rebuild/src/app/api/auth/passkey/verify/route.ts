import { NextResponse } from 'next/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { authRateLimit } from '@/server/auth-flow';
import { hit } from '@/server/rate-limit';
import { pendingUserId, verifyPasskeySecondStep } from '@/server/two-step';
import { postAuthenticationPath } from '@/server/invitation-session';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 }); }
  const response = body && typeof body === 'object' ? (body as Record<string, unknown>).response : null;
  if (!response || typeof response !== 'object' || Array.isArray(response) || typeof (response as Record<string, unknown>).id !== 'string') return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  try {
    const userId = await pendingUserId('verify');
    if (!hit(`rebuild-passkey-verify:${userId}`, await authRateLimit()).allowed) return NextResponse.json({ code: 'TOO_MANY_ATTEMPTS' }, { status: 429 });
    await verifyPasskeySecondStep(response as AuthenticationResponseJSON);
    return NextResponse.json({ ok: true, nextUrl: await postAuthenticationPath() }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ code: 'VERIFICATION_FAILED' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
}
