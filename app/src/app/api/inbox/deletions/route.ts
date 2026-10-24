import { requireViewer } from '@/server/context';
import { getInboxDeletion } from '@/modules/inbox/server/deletion';
import { OperationError, operationFailure } from '@/lib/operation-error';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'itemId') || query.getAll('itemId').length !== 1) throw new OperationError('invalid_request', 'Choose one comment.');
    return reply(await getInboxDeletion({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { itemId: query.get('itemId')! }));
  } catch (error) {
    const failure = operationFailure(error, 'Deletion status could not be confirmed. Check the current Inbox and platform state before repeating this action.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
