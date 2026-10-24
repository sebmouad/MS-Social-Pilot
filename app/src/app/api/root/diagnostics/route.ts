import { requestOrigin } from '@/server/request-origin';
import { currentRootActor } from '@/server/config/access';
import { listRootDiagnostics, runRootDiagnostics } from '@/server/root/diagnostics';
import { runtimeConfig } from '@/server/config/store';
import { formatRootTimestamp } from '@/lib/root-time';
import { OperationError, operationFailure } from '@/lib/operation-error';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function actor() {
  const current = await currentRootActor();
  if (!current?.isInstanceOwner) throw new OperationError(current ? 'forbidden' : 'unauthorized', 'Installation-owner access is required.');
  return current;
}
function failure(error: unknown) {
  const safe = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter a valid diagnostic request.') : error, 'Diagnostics could not be loaded or confirmed. Check diagnostic history before repeating a run.');
  return reply({ error: safe.error, code: safe.code }, safe.status);
}
export async function GET(request: Request) {
  try {
    const current = await actor();
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'scope') || query.getAll('scope').length > 1) throw new OperationError('invalid_request', 'Choose one diagnostic scope.');
    return reply(await listRootDiagnostics(current.id, query.get('scope') ?? 'shared'));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).origin !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const current = await actor();
    const receipt = await runRootDiagnostics(current.id, await request.json());
    // Formatted here in the operator zone; the label is decoration, so a formatting failure never hides the receipt.
    const finishedLabel = await Promise.resolve().then(async () => formatRootTimestamp(receipt.finishedAt, String(await runtimeConfig('root.operationalTimezone')))).catch(() => null);
    return reply({ ...receipt, finishedLabel });
  } catch (error) { return failure(error); }
}
