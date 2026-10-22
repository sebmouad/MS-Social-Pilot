import { currentRootActor } from '@/server/config/access';
import { requestOrigin } from '@/server/request-origin';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { checkSystemAlerts, listSystemAlerts, testSystemAlert } from './server/alerts';

async function handle(request: Request, action: 'list' | 'test' | 'check') {
  try {
    const actor = await currentRootActor();
    if (!actor?.isInstanceOwner) throw new OperationError('forbidden', 'Installation-owner access is required.');
    if (new URL(request.url).search) throw new OperationError('invalid_request', 'URL parameters are not accepted.');
    if (action === 'list') return Response.json(await listSystemAlerts(actor.id), { headers: { 'cache-control': 'no-store' } });
    let same = false; try { same = new URL(request.headers.get('origin') ?? '').origin === requestOrigin(request); } catch { /* fail closed */ }
    if (!same) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'confirmation')) throw new OperationError('invalid_request', 'Provide the exact confirmation.');
    const confirmation = 'confirmation' in value ? value.confirmation : undefined;
    return Response.json(await (action === 'test' ? testSystemAlert(actor.id, confirmation) : checkSystemAlerts(actor.id, confirmation)), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const safe = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid JSON.') : error, 'The alert outcome could not be confirmed.');
    return Response.json({ error: safe.error, code: safe.code }, { status: safe.status, headers: { 'cache-control': 'no-store' } });
  }
}
export const GET = (request: Request) => handle(request, 'list');
export const TEST = (request: Request) => handle(request, 'test');
export const CHECK = (request: Request) => handle(request, 'check');
