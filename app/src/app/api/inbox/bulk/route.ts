import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { bulkInboxAction } from '@/modules/inbox/server/bulk';
import { OperationError, operationFailure } from '@/lib/operation-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** The service owns validation, distinct-item consent, live grants and per-item outcomes, as in MCP. */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    if (!origin || new URL(origin).origin !== requestOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  } catch { return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); }
  let viewer;
  try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'Inbox actions do not accept URL filters.');
    const input: unknown = await request.json();
    return reply(await bulkInboxAction({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input));
  } catch (error) {
    const failure = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid inbox action.') : error, 'The selected items could not be updated. Check their current status before trying again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
