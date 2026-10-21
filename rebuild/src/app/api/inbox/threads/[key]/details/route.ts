import { requireViewer } from '@/server/context';
import { readInboxContactDetails } from '@/modules/inbox/server/details';
import { operationFailure } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
/** Contact details panel for one Inbox item; same service as the screen and the get_inbox_contact_details MCP tool. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try { return reply(await readInboxContactDetails({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { key: (await params).key })); }
  catch (error) { const failure = operationFailure(error, 'Contact details could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
