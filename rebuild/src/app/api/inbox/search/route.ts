import { requireViewer } from '@/server/context';
import { searchInbox } from '@/modules/inbox/server/search';
import { OperationError, operationFailure } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const query = new URL(request.url).searchParams;
    const input: Record<string, unknown> = {};
    for (const key of query.keys()) {
      if (!['q', 'channel', 'type', 'limit'].includes(key)) throw new OperationError('invalid_request', 'Choose valid search details.');
      const all = query.getAll(key);
      if (all.length > 1) throw new OperationError('invalid_request', 'Choose valid search details.');
      input[key === 'channel' ? 'channelId' : key === 'type' ? 'kind' : key] = key === 'limit' && all[0] !== undefined && /^\d+$/.test(all[0]) ? Number(all[0]) : all[0];
    }
    return reply(await searchInbox({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input));
  } catch (error) {
    const failure = operationFailure(error, 'Inbox search could not be completed. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
