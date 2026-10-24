import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { listTaskPostChoices } from '@/modules/tasks/server/tasks';
import { TASKS_FEATURE_ID, TASKS_MODULE_ID } from '@/modules/tasks/semantics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Posts the signed-in member may link to a task (Publishing's visibility rules apply). */
export async function GET(request: Request) {
  let viewer; try { viewer = await requireViewer({ module: TASKS_MODULE_ID, feature: TASKS_FEATURE_ID, channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['q', 'offset', 'channel'].includes(key) || query.getAll(key).length > 1)) throw new OperationError('invalid_request', 'Choose a valid post search.');
    const offset = query.get('offset'), channel = query.get('channel');
    if (offset !== null && !/^\d+$/.test(offset)) throw new OperationError('invalid_request', 'Choose a valid post search.');
    if (channel !== null && !/^[A-Za-z0-9_.,-]{1,2000}$/.test(channel)) throw new OperationError('invalid_request', 'Choose a valid post search.');
    return reply(await listTaskPostChoices({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { ...(query.get('q') ? { q: query.get('q') } : {}), ...(offset === null ? {} : { offset: Number(offset) }), ...(channel ? { channelIds: channel.split(',').map(id => id.trim()).filter(Boolean) } : {}) }));
  } catch (error) { const failure = operationFailure(error, 'Posts could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
