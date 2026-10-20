import { requestOrigin } from '@/server/request-origin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash } from '@/server/data';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { selectWorkspace } from '@/modules/agency/server/workspace-selection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) throw new OperationError('forbidden', 'Use a signed-in browser session.');
    let input: unknown;
    try { input = await request.json(); } catch { throw new OperationError('invalid_request', 'Invalid workspace selection.'); }
    const token = (await cookies()).get(LEGACY_SESSION_COOKIE)?.value;
    const sessionTokenHash = token ? hashLegacySessionToken(token) : null;
    const session = sessionTokenHash ? await getSessionByTokenHash(sessionTokenHash) : null;
    if (!sessionTokenHash || !isUsableLegacySession(session, undefined)) throw new OperationError('unauthorized', 'Sign in to continue.');
    return NextResponse.json(await selectWorkspace({ userId: session.userId, workspaceId: '', sessionTokenHash }, input), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const safe = operationFailure(error, 'Workspace selection could not be saved.');
    return NextResponse.json({ error: safe.error, code: safe.code }, { status: safe.status, headers: { 'cache-control': 'no-store' } });
  }
}
