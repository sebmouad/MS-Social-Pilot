import { currentRootActor } from '@/server/config/access';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { readRootPlatformPublicationEvidence, runRootPlatformPublicationAction } from '@/server/root/platform-publication-evidence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request) {
  try {
    const current = await currentRootActor();
    if (!current?.isInstanceOwner) throw new OperationError(current ? 'forbidden' : 'unauthorized', 'Installation-owner access is required.');
    const query = new URL(request.url).searchParams;
    const allowed = new Set(['providerId', 'operationId', 'resultCap']);
    if ([...query.keys()].some(key => !allowed.has(key)) || [...allowed].some(key => query.getAll(key).length > 1)) {
      throw new OperationError('invalid_request', 'Use one platform, optional operation ID, and optional result limit.');
    }
    const providerId = query.get('providerId');
    const operationId = query.get('operationId');
    const rawCap = query.get('resultCap');
    if (!providerId || !/^[A-Za-z0-9_-]{1,100}$/.test(providerId) ||
      operationId !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(operationId) ||
      rawCap !== null && (!/^\d{1,4}$/.test(rawCap) || Number(rawCap) < 1 || Number(rawCap) > 1000)) {
      throw new OperationError('invalid_request', 'Choose an installed platform, valid publication operation and result limit.');
    }
    const resultCap = rawCap === null ? undefined : Number(rawCap);
    return reply(await readRootPlatformPublicationEvidence(current.id, {
      providerId,
      ...(operationId === null ? {} : { operationId }),
      ...(resultCap === undefined ? {} : { resultCap }),
    }));
  } catch (error) {
    const safe = operationFailure(error, 'Platform publication evidence could not be loaded.');
    return reply({ error: safe.error, code: safe.code }, safe.status);
  }
}

export async function POST(request: Request) {
  try {
    const requestOrigin = new URL(request.url).origin;
    if (request.headers.get('origin') !== requestOrigin) throw new OperationError('forbidden', 'Use this action from the installation control panel.');
    const current = await currentRootActor();
    if (!current?.isInstanceOwner) throw new OperationError(current ? 'forbidden' : 'unauthorized', 'Installation-owner access is required.');
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new OperationError('invalid_request', 'Enter a valid platform action and its exact confirmation.'); }
    return reply(await runRootPlatformPublicationAction(current.id, body));
  } catch (error) {
    const safe = operationFailure(error, 'The platform action result could not be confirmed. Check platform evidence before taking further action.');
    return reply({ error: safe.error, code: safe.code }, safe.status);
  }
}
