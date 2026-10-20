import { requireViewer } from '@/server/context';
import { readPublishingPostPage } from '@/modules/publishing/server/read';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { createPost } from '@/modules/publishing/server/lifecycle';
import { parsePublishingMedia } from '@/modules/publishing/media-support';
import { parseScheduleMode } from '@/modules/publishing/remote-scheduling';
import { parseDestinationScheduleModes } from '@/modules/publishing/server/schedule-modes';
import { bodyInstant, publishingWrite, requireBodyConfirmation } from '@/modules/publishing/server/rest';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Create a post (MCP `create_post`, confirmation CREATE POST). Without scheduledAt it is a draft; with scheduledAt it is scheduled, and
 * scheduleMode ('application' | 'remote') chooses whether this app or the destination's platform holds it until then.
 */
export async function POST(request: Request) {
  return publishingWrite(request, async ({ actor, body }) => {
    requireBodyConfirmation(body, 'CREATE POST');
    if (!Array.isArray(body.targetIds) || body.targetIds.some(id => typeof id !== 'string')) throw new OperationError('invalid_request', 'targetIds must be an array of destination IDs.');
    const scheduledAt = body.scheduledAt === undefined ? undefined : bodyInstant(body, 'scheduledAt').date;
    const result = await createPost(actor, { message: typeof body.message === 'string' ? body.message : '', firstComment: typeof body.firstComment === 'string' ? body.firstComment : '',
      ...(body.firstCommentDelayMinutes === undefined ? {} : { firstCommentDelayMinutes: body.firstCommentDelayMinutes as number }),
      destinationFormats: body.destinationFormats, targetIds: body.targetIds as string[], link: typeof body.link === 'string' ? body.link : undefined, media: parsePublishingMedia(body.media ?? []),
      ...(typeof body.labelId === 'string' ? { labelId: body.labelId } : {}), ...(scheduledAt ? { scheduledAt } : {}),
      ...(parseScheduleMode(body.scheduleMode) ? { scheduleMode: parseScheduleMode(body.scheduleMode) } : {}),
      ...(parseDestinationScheduleModes(body.destinationScheduleModes) ? { destinationScheduleModes: parseDestinationScheduleModes(body.destinationScheduleModes) } : {}) });
    return { ...result, status: scheduledAt ? 'scheduled' : 'draft' };
  }, { status: 201, failure: 'The save result could not be confirmed. Check Posts before trying again.' });
}
export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['page', 'status', 'channel', 'q'].includes(key) || params.getAll(key).length !== 1)) throw new OperationError('invalid_request', 'Choose valid post filters.');
    const page = params.get('page');
    if (page !== null && !/^[1-9]\d*$/.test(page)) throw new OperationError('invalid_request', 'Choose a valid result page.');
    return reply(await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {
      ...(page === null ? {} : { page: Number(page) }), status: params.get('status') ?? undefined, channelId: params.get('channel') ?? undefined,
      ...(params.has('q') ? { q: params.get('q')! } : {}),
    }));
  } catch (error) {
    const failure = operationFailure(error, 'Posts could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
