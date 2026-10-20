import { OperationError } from '@/lib/operation-error';
import { cancelScheduledPost, publishPost, reschedulePostToInstant, reviewPost, schedulePost, submitPostForApproval, syncPostStatus } from '@/modules/publishing/server/lifecycle';
import { parseScheduleMode } from '@/modules/publishing/remote-scheduling';
import { bodyInstant, bodyString, publishingWrite, requireBodyConfirmation } from '@/modules/publishing/server/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; action: string }> };

/**
 * Post lifecycle actions, one route per verb under /api/publishing/posts/{id}/{action}. Each call needs the same exact
 * confirmation the MCP tool of the same name asks for, then runs the shared lifecycle service.
 *
 *   publish           PUBLISH POST {id}                    body: { retryOnly? }
 *   schedule          SCHEDULE POST {id} {scheduledAt}     body: { scheduledAt, scheduleMode?: 'application'|'remote' }
 *   reschedule        RESCHEDULE POST {id} {scheduledAt}   body: { scheduledAt }
 *   cancel-schedule   CANCEL SCHEDULE {id}
 *   submit            SUBMIT POST {id}
 *   review            APPROVE POST {id} | REJECT POST {id} body: { decision }
 *   sync              SYNC POST STATUS {id}
 */
export async function POST(request: Request, context: Context) {
  const { id, action } = await context.params;
  return publishingWrite(request, async ({ actor, body }) => {
    switch (action) {
      case 'publish': {
        requireBodyConfirmation(body, `PUBLISH POST ${id}`);
        const result = await publishPost(actor, id, undefined, body.retryOnly === true ? { retryOnly: true } : {});
        return { postId: id, ...result };
      }
      case 'schedule': {
        const when = bodyInstant(body, 'scheduledAt');
        requireBodyConfirmation(body, `SCHEDULE POST ${id} ${when.text}`);
        const scheduleMode = parseScheduleMode(body.scheduleMode);
        const result = await schedulePost(actor, id, when.date, scheduleMode ? { scheduleMode } : {});
        return { postId: id, scheduledAt: when.date.toISOString(), ...result };
      }
      case 'reschedule': {
        const when = bodyInstant(body, 'scheduledAt');
        requireBodyConfirmation(body, `RESCHEDULE POST ${id} ${when.text}`);
        const result = await reschedulePostToInstant(actor, id, when.date);
        return { postId: id, scheduledAt: result.scheduledAt.toISOString() };
      }
      case 'cancel-schedule':
        requireBodyConfirmation(body, `CANCEL SCHEDULE ${id}`);
        await cancelScheduledPost(actor, id);
        return { postId: id, status: 'draft' };
      case 'submit':
        requireBodyConfirmation(body, `SUBMIT POST ${id}`);
        await submitPostForApproval(actor, id);
        return { postId: id, status: 'pending_approval' };
      case 'review': {
        const decision = bodyString(body, 'decision');
        if (decision !== 'approve' && decision !== 'reject') throw new OperationError('invalid_request', 'decision must be approve or reject.');
        requireBodyConfirmation(body, `${decision.toUpperCase()} POST ${id}`);
        await reviewPost(actor, id, decision);
        return { postId: id, decision };
      }
      case 'sync': {
        requireBodyConfirmation(body, `SYNC POST STATUS ${id}`);
        return { postId: id, ...await syncPostStatus(actor, id) };
      }
      default:
        throw new OperationError('not_found', 'Unknown post action.');
    }
  });
}
