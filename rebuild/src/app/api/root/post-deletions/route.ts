import { currentRootActor } from '@/server/config/access';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { listRootPostDeletions, recordRootPostDeletionOutcome } from '@/server/root/post-deletions';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

async function actor() {
  const current = await currentRootActor();
  if (!current?.isInstanceOwner) throw new OperationError(current ? 'forbidden' : 'unauthorized', 'Installation-owner access is required.');
  return current;
}

function failure(error: unknown, fallback: string) {
  const safe = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter a valid post deletion outcome.') : error, fallback);
  return reply({ error: safe.error, code: safe.code }, safe.status);
}

export async function GET(request: Request) {
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'This recovery list does not accept filters.');
    const current = await actor();
    return reply(await listRootPostDeletions(current.id));
  } catch (error) { return failure(error, 'Post deletion history could not be loaded.'); }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    let sameOrigin = false;
    try { sameOrigin = Boolean(origin && new URL(origin).origin === new URL(request.url).origin); } catch { /* Invalid Origin is denied below. */ }
    if (!sameOrigin) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const current = await actor();
    return reply(await recordRootPostDeletionOutcome(current.id, await request.json()));
  } catch (error) { return failure(error, 'The operator outcome could not be recorded. Check recovery history before repeating it.'); }
}
