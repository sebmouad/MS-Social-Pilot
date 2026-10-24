import { currentRootActor } from '@/server/config/access';
import { loadRootOperations } from '@/server/root/operations';
import { OperationError, operationFailure } from '@/lib/operation-error';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request) {
  try {
    const actor = await currentRootActor();
    if (!actor?.isInstanceOwner) return reply({ error: 'Not found.' }, actor ? 404 : 401);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'moduleId') || query.getAll('moduleId').length > 1) throw new OperationError('invalid_request', 'Choose one product module.');
    return reply(await loadRootOperations(actor.id, query.get('moduleId') ?? undefined));
  } catch (error) {
    const safe = operationFailure(error, 'Worker health could not be loaded. Check service availability and try again.');
    return reply({ error: safe.error, code: safe.code }, safe.status);
  }
}
