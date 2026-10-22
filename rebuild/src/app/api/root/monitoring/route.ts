import { currentRootActor } from '@/server/config/access';
import { readRootOperatorMonitoring, runRootOperatorMonitoring } from '@/modules/root/server/operator-monitoring';
import { OperationError, operationFailure } from '@/lib/operation-error';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function actorId() {
  const actor = await currentRootActor();
  if (!actor) throw new OperationError('unauthorized', 'Sign in to continue.');
  return actor.id;
}
export async function GET(request: Request) {
  try {
    const id = await actorId();
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'This read does not accept filters.');
    return reply(await readRootOperatorMonitoring(id));
  } catch (error) { const safe = operationFailure(error, 'Monitoring could not be loaded.'); return reply({ error: safe.error, code: safe.code }, safe.status); }
}
export async function POST(request: Request) {
  try {
    const id = await actorId();
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'confirmation')) throw new OperationError('invalid_request', 'Enter the exact confirmation.');
    return reply(await runRootOperatorMonitoring(id, (body as { confirmation?: unknown }).confirmation));
  } catch (error) { const safe = operationFailure(error, 'Monitoring evaluation was not confirmed.'); return reply({ error: safe.error, code: safe.code }, safe.status); }
}
