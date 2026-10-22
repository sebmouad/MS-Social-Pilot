import { NextResponse } from 'next/server';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { currentRootActor } from '@/server/config/access';
import { reportClientError } from '@/server/errors/client-report';
import { loadErrorsPolicy } from '@/server/errors/recorder';
import { requestOrigin } from '@/server/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  try { return Boolean(origin) && new URL(origin!).origin === requestOrigin(request); } catch { return false; }
}

/** Browser error reports for Root › Errors. Signed-in people only, same origin, bounded size, rate limited by the service. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const user = await currentRootActor();
  if (!user) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try {
    const policy = await loadErrorsPolicy();
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > policy['errors.clientReportMaxBytes']) throw new OperationError('invalid_request', 'The error report was too large.');
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new OperationError('invalid_request', 'The error report was not valid.'); }
    const result = await reportClientError({ userId: user.id }, body);
    return reply({ ok: result.recorded, ...(result.reason ? { reason: result.reason } : {}) });
  } catch (error) {
    const failure = operationFailure(error, 'The error report could not be saved.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
