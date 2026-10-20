import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { hit } from '@/server/rate-limit';
import { authRateLimit } from '@/server/auth-flow';
import { beginEnrollment, confirmEnrollment, pendingUserId } from '@/server/two-step';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== requestOrigin(request)) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 }); }
  const action = body && typeof body === 'object' ? (body as Record<string, unknown>).action : null;
  try {
    const userId = await pendingUserId('enroll');
    const attempt = hit(`rebuild-enroll:${userId}`, await authRateLimit());
    if (!attempt.allowed) return NextResponse.json({ code: 'TOO_MANY_ATTEMPTS' }, { status: 429 });
    if (action === 'begin') {
      const setup = await beginEnrollment(new URL(request.url).hostname);
      return NextResponse.json({ ok: true, ...setup });
    }
    if (action === 'confirm') {
      const code = (body as Record<string, unknown>).code;
      if (typeof code !== 'string' || code.length < 6 || code.length > 32) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 });
      const recoveryCodes = await confirmEnrollment(code);
      return NextResponse.json({ ok: true, recoveryCodes });
    }
    return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  } catch {
    return NextResponse.json({ code: 'ENROLLMENT_FAILED' }, { status: 401 });
  }
}
