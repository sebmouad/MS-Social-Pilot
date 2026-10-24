import { OperationError, operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { accountSessionActor } from './account-session';
import { startConnection } from './connection-start';

export async function connectionStartHttp(request: Request, platform: string) {
  try {
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) throw new OperationError('forbidden', 'Use a signed-in browser session to connect an account.');
    if (request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const viewer = await requireViewer({ feature: 'settings/connections' });
    const actor = await accountSessionActor(viewer.user.id, viewer.workspaceId);
    const input = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'confirmation')) throw new OperationError('invalid_request', 'Confirm the account connection before continuing.');
    return await startConnection(actor, { ...input, platform }, request);
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    const safe = operationFailure(typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT') ? new OperationError('unauthorized', 'Sign in to continue.') : error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'Connection unavailable. Try again or contact support.');
    return Response.json({ error: safe.error, code: safe.code }, { status: safe.status, headers: { 'cache-control': 'no-store' } });
  }
}
