import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { accountSessionActor } from './account-session';
import { appearanceSession } from './appearance';
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
export async function appearanceHttp(request: Request, write = false) {
  try {
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) throw new OperationError('forbidden', 'Use a signed-in browser session.');
    if (write && request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const viewer = await requireViewer({ feature: 'settings/appearance', channelScoped: true });
    const actor = await accountSessionActor(viewer.user.id, viewer.workspaceId);
    return reply(await appearanceSession(actor, write ? await request.json() : undefined));
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    const safe = operationFailure(typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT') ? new OperationError('unauthorized', 'Sign in to continue.') : error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'Appearance could not be saved.');
    return reply({ error: safe.error, code: safe.code }, safe.status);
  }
}
