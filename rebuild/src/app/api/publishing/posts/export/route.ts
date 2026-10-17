import { requireViewer } from '@/server/context';
import { exportPublishingPosts } from '@/modules/publishing/server/export';
import { OperationError, operationFailure } from '@/lib/operation-error';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }

  try {
    const params = new URL(request.url).searchParams;
    const keys = [...params.keys()];
    if (keys.some(key => !['q', 'status', 'channel'].includes(key))
      || ['q', 'status', 'channel'].some(key => params.getAll(key).length > 1)) {
      throw new OperationError('invalid_request', 'Choose one value for each supported Publishing export filter.');
    }
    const result = await exportPublishingPosts({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {
      ...(params.has('q') ? { q: params.get('q')! } : {}),
      ...(params.has('status') ? { status: params.get('status')! } : {}),
      ...(params.has('channel') ? { channelId: params.get('channel')! } : {}),
    });
    return new Response(result.csv, { headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="posts.csv"',
      'cache-control': 'no-store',
      'x-msp-export-format': 'posts-v1',
      'x-msp-post-count': String(result.postCount),
      'x-msp-export-bytes': String(result.byteLength),
    } });
  } catch (error) {
    const failure = operationFailure(error, 'The Posts export could not be prepared. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
