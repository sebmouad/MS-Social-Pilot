import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { runBulkPostAction } from '@/modules/publishing/server/bulk';
import { operationFailure } from '@/lib/operation-error';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Body: { action, postIds, requestId, confirmation: "<ACTION> <n> POSTS", date?, time? }. */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  let same = false; try { same = Boolean(origin) && new URL(origin as string).origin === requestOrigin(request); } catch { same = false; }
  if (!same) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer; try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: 'Choose posts and an action, then confirm.', code: 'invalid_request' }, 400); }
  try { return reply(await runBulkPostAction({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, body)); }
  catch (error) { const failure = operationFailure(error, 'The bulk action could not be confirmed. Refresh Posts and check each post.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
