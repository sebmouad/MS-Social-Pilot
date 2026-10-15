import { NextResponse } from 'next/server';
import { authRateLimit } from '@/server/auth-flow';
import { hit } from '@/server/rate-limit';
import { beginPasskeyVerification, pendingUserId } from '@/server/two-step';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 403 });
  try {
    const userId = await pendingUserId('verify');
    if (!hit(`rebuild-passkey-options:${userId}`, await authRateLimit()).allowed) return NextResponse.json({ code: 'TOO_MANY_ATTEMPTS' }, { status: 429 });
    const options = await beginPasskeyVerification();
    return NextResponse.json({ options }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ code: 'PASSKEY_UNAVAILABLE' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
}
