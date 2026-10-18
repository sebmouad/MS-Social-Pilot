import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { getTask } from '@/modules/tasks/server/tasks';
import { TASKS_FEATURE_ID, TASKS_MODULE_ID } from '@/modules/tasks/semantics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** One task and a page of its comments. `?commentOffset=` continues a long thread. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let viewer; try { viewer = await requireViewer({ module: TASKS_MODULE_ID, feature: TASKS_FEATURE_ID, channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'commentOffset' || query.getAll(key).length > 1)) throw new OperationError('invalid_request', 'Choose a valid comment page.');
    const offset = query.get('commentOffset');
    if (offset !== null && !/^\d+$/.test(offset)) throw new OperationError('invalid_request', 'Choose a valid comment page.');
    return reply(await getTask({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, (await context.params).id, offset === null ? undefined : { commentOffset: Number(offset) }));
  } catch (error) { const failure = operationFailure(error, 'The task could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
