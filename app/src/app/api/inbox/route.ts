import { requireViewer } from '@/server/context';
import { readInboxList } from '@/modules/inbox/server/read';
import { inboxListInput, type InboxSearchParams } from '@/modules/inbox/query';
import { OperationError, operationFailure } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const query = new URL(request.url).searchParams;
    const values: InboxSearchParams = {};
    for (const key of query.keys()) {
      if (!['channel', 'type', 'status', 'hidden', 'q', 'cursor', 'limit'].includes(key)) throw new OperationError('invalid_request', 'Choose valid Inbox filters.');
      const all = query.getAll(key); values[key] = all.length > 1 ? all : all[0];
    }
    return reply(await readInboxList({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, inboxListInput(values)));
  } catch (error) {
    const failure = operationFailure(error, 'Inbox could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
