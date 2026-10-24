import { requireViewer } from '@/server/context';
import { readInboxThread } from '@/modules/inbox/server/read';
import { OperationError, operationFailure } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['cursor', 'limit'].includes(key)) || [...query.keys()].some(key => query.getAll(key).length > 1)) throw new OperationError('invalid_request', 'Choose one history cursor and page limit.');
    const limit = query.get('limit');
    const input = { key: (await params).key, ...(query.has('cursor') ? { cursor: query.get('cursor') } : {}), ...(limit !== null ? { limit: /^\d+$/.test(limit) ? Number(limit) : limit } : {}) };
    return reply(await readInboxThread({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input));
  } catch (error) {
    const failure = operationFailure(error, 'Conversation history could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
