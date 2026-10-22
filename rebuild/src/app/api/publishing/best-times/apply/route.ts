import { NextResponse } from 'next/server';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { getBestTimeApplyStatus, runBestTimeApplyNow } from '@/modules/publishing/server/best-time-apply';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Automatic best-time application: status for owners/admins, and a confirmed apply-now. The service repeats every check. */
export async function GET() {
  try {
    const viewer = await requireViewer({ module: 'settings', feature: 'settings/workspace' });
    return reply(await getBestTimeApplyStatus({ userId: viewer.user.id, workspaceId: viewer.workspaceId }));
  } catch (error) {
    const failure = operationFailure(error, 'Best-time status is unavailable.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    if (!origin || new URL(origin).origin !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const viewer = await requireViewer({ module: 'settings', feature: 'settings/workspace', write: true });
    const input: unknown = await request.json().catch(() => ({}));
    return reply(await runBestTimeApplyNow({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input));
  } catch (error) {
    const failure = operationFailure(error, 'Best times could not be applied.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
