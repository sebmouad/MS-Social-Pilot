import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { listTasks, performTaskAction } from '@/modules/tasks/server/tasks';
import { TASKS_FEATURE_ID, TASKS_MODULE_ID } from '@/modules/tasks/semantics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin) return false; try { return new URL(origin).origin === requestOrigin(request); } catch { return false; } }
/** Entry-point gate (module + feature); the service repeats the full check, this only refuses early. */
async function actor(write: boolean) {
  const viewer = await requireViewer({ module: TASKS_MODULE_ID, feature: TASKS_FEATURE_ID, channelScoped: true, ...(write ? { write: true } : {}) });
  return { userId: viewer.user.id, workspaceId: viewer.workspaceId };
}
const UNSIGNED = () => reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
const KEYS = ['status', 'assignee', 'overdue', 'q', 'offset', 'limit', 'channel'];

export async function GET(request: Request) {
  let current; try { current = await actor(false); } catch { return UNSIGNED(); }
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !KEYS.includes(key) || query.getAll(key).length > 1)) throw new OperationError('invalid_request', 'Choose valid task filters.');
    const number = (key: string) => { const value = query.get(key); if (value === null) return {}; if (!/^\d+$/.test(value)) throw new OperationError('invalid_request', 'Choose valid task filters.'); return { [key]: Number(value) }; };
    const overdue = query.get('overdue'), channel = query.get('channel');
    if (overdue !== null && overdue !== 'true' && overdue !== 'false') throw new OperationError('invalid_request', 'Choose valid task filters.');
    if (channel !== null && !/^[A-Za-z0-9_.,-]{1,2000}$/.test(channel)) throw new OperationError('invalid_request', 'Choose valid task filters.');
    return reply(await listTasks(current, {
      ...(query.get('status') ? { status: query.get('status') } : {}), ...(query.get('assignee') ? { assignee: query.get('assignee') } : {}),
      ...(overdue !== null ? { overdue: overdue === 'true' } : {}), ...(query.get('q') ? { q: query.get('q') } : {}), ...number('offset'), ...number('limit'),
      ...(channel ? { channelIds: channel.split(',').map(id => id.trim()).filter(Boolean) } : {}),
    }));
  } catch (error) { const failure = operationFailure(error, 'Tasks could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let current; try { current = await actor(true); } catch { return UNSIGNED(); }
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'Task actions do not accept URL parameters.');
    return reply(await performTaskAction(current, await request.json()));
  } catch (error) {
    const typed = error instanceof z.ZodError || error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid task action.') : error;
    const failure = operationFailure(typed, 'The task change could not be confirmed. Refresh the list and check the task before trying again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
