import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { accountSessionActor } from './account-session';
import { webhookSecretAction } from './webhook-secrets';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
export async function webhookSecretHttp(request: Request, id: string, action: 'reveal' | 'rotate') {
  try {
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) throw new OperationError('forbidden', 'Use a signed-in browser session to show a signing secret.');
    if (request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const viewer = await requireViewer({ feature: 'settings/webhooks', write: true });
    const actor = await accountSessionActor(viewer.user.id, viewer.workspaceId);
    const input: unknown = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input) || ('id' in input && input.id !== id)) throw new OperationError('invalid_request', 'Choose a valid webhook.');
    return reply(await webhookSecretAction(actor, { ...input, id }, action));
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    const safe = operationFailure(typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT') ? new OperationError('unauthorized', 'Sign in to continue.') : error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'The signing secret could not be shown.');
    return reply({ error: safe.error, code: safe.code }, safe.status);
  }
}
