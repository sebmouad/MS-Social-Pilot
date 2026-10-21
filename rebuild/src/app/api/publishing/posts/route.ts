import { requireViewer } from '@/server/context';
import { readPublishingPostPage } from '@/modules/publishing/server/read';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { createPublishingPost } from '@/modules/publishing/server/api-writes';
import { publishingWrite } from '@/modules/publishing/server/rest';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Create a post (MCP `create_post`, confirmation CREATE POST). Without scheduledAt it is a draft; with scheduledAt it is scheduled, and
 * scheduleMode ('application' | 'remote') chooses whether this app or the destination's platform holds it until then.
 */
export async function POST(request: Request) {
  return publishingWrite(request, ({ actor, body }) => createPublishingPost(actor, body),
    { status: 201, failure: 'The save result could not be confirmed. Check Posts before trying again.' });
}

export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['page', 'status', 'channel', 'q', 'origin'].includes(key) || params.getAll(key).length !== 1)) throw new OperationError('invalid_request', 'Choose valid post filters.');
    const page = params.get('page');
    if (page !== null && !/^[1-9]\d*$/.test(page)) throw new OperationError('invalid_request', 'Choose a valid result page.');
    return reply(await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {
      ...(page === null ? {} : { page: Number(page) }), status: params.get('status') ?? undefined, channelId: params.get('channel') ?? undefined,
      ...(params.has('origin') ? { origin: params.get('origin')! } : {}),
      ...(params.has('q') ? { q: params.get('q')! } : {}),
    }));
  } catch (error) {
    const failure = operationFailure(error, 'Posts could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
