import { requestOrigin } from '@/server/request-origin';
import { revalidatePath } from 'next/cache';
import { requireViewer } from '@/server/context';
import { retryFirstComment } from '@/modules/publishing/server/first-comment';
import { OperationError, operationFailure } from '@/lib/operation-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request: Request) {
  let sameOrigin = false;
  try { sameOrigin = new URL(request.headers.get('origin') ?? '').origin === requestOrigin(request); } catch { /* Missing or malformed origin. */ }
  if (!sameOrigin) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try {
    const scope = viewer.permissions.pageScope;
    const result = await retryFirstComment({ userId: viewer.user.id, workspaceId: viewer.workspaceId,
      ...(scope.all ? {} : { allowedTargetIds: scope.ids }) }, await request.json());
    for (const path of ['/publishing/posts', '/publishing/calendar', '/publishing/queue', '/publishing/approvals']) {
      try { revalidatePath(path); } catch { /* Preserve the committed receipt. */ }
    }
    return reply(result);
  } catch (error) {
    const failure = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Choose a valid first-comment retry request.') : error,
      'The retry outcome could not be confirmed. Refresh Posts and check the comment before another action.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
