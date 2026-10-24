import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { accountSessionActor } from '../server/account-session';
import { prepareWebApp, readWebApp } from './service';
export async function webAppHttp(request: Request, write = false) {
  try {
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) throw new OperationError('forbidden', 'Use a signed-in browser session.');
    if (write && request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const viewer = await requireViewer({ feature: 'settings/appearance', channelScoped: true });
    const actor = await accountSessionActor(viewer.user.id, viewer.workspaceId);
    return Response.json(write ? await prepareWebApp(actor, await request.json()) : await readWebApp(actor), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    const safe = operationFailure(typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT') ? new OperationError('unauthorized', 'Sign in to continue.') : error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'App installation could not be prepared.');
    return Response.json({ error: safe.error, code: safe.code }, { status: safe.status, headers: { 'cache-control': 'no-store' } });
  }
}
