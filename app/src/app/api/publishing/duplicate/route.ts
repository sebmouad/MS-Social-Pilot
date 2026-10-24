import { requestOrigin } from '@/server/request-origin';
import { revalidatePath } from 'next/cache';
import { requireViewer } from '@/server/context';
import { duplicatePost } from '@/modules/publishing/server/duplicate';
import { OperationError, operationFailure } from '@/lib/operation-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);

  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }

  try {
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const result = await duplicatePost(actor, await request.json());
    // The service has committed the durable receipt before returning. Cache
    // failures must not turn that confirmed draft into an apparent failure.
    for (const path of ['/content', '/content/calendar', '/content/queue', '/content/approvals']) {
      try { revalidatePath(path); } catch { /* Keep the committed receipt as the response. */ }
    }
    return reply(result, result.replayed ? 200 : 201);
  } catch (error) {
    const typedError = error instanceof SyntaxError
      ? new OperationError('invalid_request', 'Enter a valid post duplication request.')
      : error;
    const failure = operationFailure(typedError, 'The post duplication outcome could not be confirmed. Check the Posts list before trying again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
