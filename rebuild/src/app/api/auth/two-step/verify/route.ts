import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { hit } from '@/server/rate-limit';
import { authRateLimit } from '@/server/auth-flow';
import { pendingUserId, verifySecondStep } from '@/server/two-step';
import { postAuthenticationPath } from '@/server/invitation-session';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== requestOrigin(request)) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 }); }
  const code = body && typeof body === 'object' ? (body as Record<string, unknown>).code : null;
  if (typeof code !== 'string' || code.length < 6 || code.length > 32) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  try {
    const userId = await pendingUserId('verify');
    const attempt = hit(`rebuild-two-step:${userId}`, await authRateLimit());
    if (!attempt.allowed) return NextResponse.json({ code: 'TOO_MANY_ATTEMPTS' }, { status: 429 });
    const used = await verifySecondStep(code);
    return NextResponse.json({ ok: true, used, nextUrl: await postAuthenticationPath() });
  } catch {
    return NextResponse.json({ code: 'VERIFICATION_FAILED' }, { status: 401 });
  }
}
