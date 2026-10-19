import { requireViewer } from '@/server/context';
import { deleteSavedView } from '@/modules/publishing/server/saved-views';
import { operationFailure } from '@/lib/operation-error';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Removes one of the viewer's own saved views. Body: { confirmation: "DELETE SAVED VIEW <id>" }. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  let same = false; try { same = Boolean(origin) && new URL(origin as string).origin === new URL(request.url).origin; } catch { same = false; }
  if (!same) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer; try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  const { id } = await params;
  let body: { confirmation?: unknown } = {};
  try { body = await request.json(); } catch { return reply({ error: 'Confirm the exact saved view removal.', code: 'invalid_request' }, 400); }
  try { return reply(await deleteSavedView({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { id, confirmation: body?.confirmation })); }
  catch (error) { const failure = operationFailure(error, 'The view could not be removed.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
