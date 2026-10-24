import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { deleteInboxSavedView } from '@/modules/inbox/server/saved-views';
import { operationFailure } from '@/lib/operation-error';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  try { if (!origin || new URL(origin).origin !== requestOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); }
  catch { return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); }
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: 'Enter valid saved view details.', code: 'invalid_request' }, 400); }
  let viewer; try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try { return reply(await deleteInboxSavedView({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { ...(typeof body === 'object' && body ? body : {}), id })); }
  catch (error) { const failure = operationFailure(error, 'The view could not be deleted.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
