import { requestOrigin } from '@/server/request-origin';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { personKeySessionActor } from './session';
import { issuePersonKey, listPersonKeys, revokePersonKey } from './service';
import { personKeyCopy } from './copy';
import { labelPersonKeys } from './labels';

const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
async function handle(request: Request, action: 'list' | 'issue' | 'revoke') {
  try {
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) throw new OperationError('unauthorized', 'Use a browser session.');
    if (new URL(request.url).search) throw new OperationError('invalid_request', 'URL parameters are not accepted.');
    if (action !== 'list') {
      if (request.headers.get('origin') !== requestOrigin(request)) throw new OperationError('forbidden', 'Same-origin confirmation is required.');
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new OperationError('invalid_request', 'JSON is required.');
    }
    const actor = await personKeySessionActor();
    const value = action === 'list' ? await listPersonKeys(actor) : action === 'issue' ? await issuePersonKey(actor, await request.json()) : await revokePersonKey(actor, await request.json());
    return reply(action === 'list' ? labelPersonKeys(value as Awaited<ReturnType<typeof listPersonKeys>>, request.headers.get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en') : value);
  } catch (error) {
    const safe = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'Person credentials are unavailable.');
    const copy = personKeyCopy[request.headers.get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en'];
    return reply({ error: copy.failed, code: safe.code }, safe.status);
  }
}
export const GET = (request: Request) => handle(request, 'list');
export const POST = (request: Request) => handle(request, 'issue');
export const DELETE = (request: Request) => handle(request, 'revoke');
