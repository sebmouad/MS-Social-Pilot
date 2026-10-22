import { OperationError, operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { accountSessionActor } from './account-session';
import { connectWithCredentials, readConnectionCredentialForm } from './connection-credentials';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
function failure(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  const safe = operationFailure(typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT') ? new OperationError('unauthorized', 'Sign in to continue.') : error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'Connection unavailable. Try again or contact support.');
  return reply({ error: safe.error, code: safe.code }, safe.status);
}
const refuseKeys = (request: Request) => { if (request.headers.has('authorization') || request.headers.has('x-api-key')) throw new OperationError('forbidden', 'Use a signed-in browser session to connect an account.'); };

export async function connectionCredentialFormHttp(request: Request, platform: string) {
  try {
    refuseKeys(request);
    const viewer = await requireViewer({ feature: 'settings/connections' });
    const locale = new URL(request.url).searchParams.get('locale') === 'fr' ? 'fr' : 'en';
    return reply(await readConnectionCredentialForm(await accountSessionActor(viewer.user.id, viewer.workspaceId), platform, locale));
  } catch (error) { return failure(error); }
}

export async function connectionCredentialsHttp(request: Request, platform: string) {
  try {
    refuseKeys(request);
    if (request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const viewer = await requireViewer({ feature: 'settings/connections' });
    const input: unknown = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'fields' && key !== 'confirmation')) throw new OperationError('invalid_request', 'Provide the connection fields and confirmation.');
    return reply(await connectWithCredentials(await accountSessionActor(viewer.user.id, viewer.workspaceId), { ...input, platform }));
  } catch (error) { return failure(error); }
}
