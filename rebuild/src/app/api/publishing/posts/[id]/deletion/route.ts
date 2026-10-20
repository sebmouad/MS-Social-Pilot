import { OperationError, operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { finishPostDeletion, getPostDeletion, recordPostDeletionOutcome } from '@/modules/publishing/server/deletion';
import { bodyString, publishingWrite, reply, requireBodyConfirmation } from '@/modules/publishing/server/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

/** Current durable deletion receipt for a post (MCP `get_post_deletion_status`). */
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  let viewer;
  try { viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try {
    const scope = viewer.permissions.pageScope;
    return reply(await getPostDeletion({ userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(scope.all ? {} : { allowedTargetIds: scope.ids }) }, { postId: id }));
  } catch (error) {
    const failure = operationFailure(error, 'Deletion status could not be loaded.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

/**
 * Recovery after a remote deletion. body: { intent: 'finish', confirmation: "FINISH POST DELETION {id}" } removes the local post once every
 * platform deletion is confirmed; { intent: 'record', operationId, outcome: 'deleted'|'not_deleted', verifiedOnPlatform: true,
 * confirmation: "RECORD POST DELETION {operationId} DELETED|NOT DELETED" } saves an outcome verified outside the app.
 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return publishingWrite(request, async ({ actor, body }) => {
    const intent = bodyString(body, 'intent');
    if (intent === 'finish') {
      requireBodyConfirmation(body, `FINISH POST DELETION ${id}`);
      return finishPostDeletion(actor, { postId: id, confirmation: `FINISH POST DELETION ${id}` });
    }
    if (intent === 'record') {
      const operationId = bodyString(body, 'operationId');
      const outcome = body.outcome;
      if (outcome !== 'deleted' && outcome !== 'not_deleted') throw new OperationError('invalid_request', 'outcome must be deleted or not_deleted.');
      if (body.verifiedOnPlatform !== true) throw new OperationError('invalid_request', 'verifiedOnPlatform must be true after an external platform check.');
      const confirmation = `RECORD POST DELETION ${operationId} ${outcome === 'deleted' ? 'DELETED' : 'NOT DELETED'}`;
      requireBodyConfirmation(body, confirmation);
      return recordPostDeletionOutcome(actor, { postId: id, operationId, outcome, confirmation, verifiedOnPlatform: true });
    }
    throw new OperationError('invalid_request', 'intent must be finish or record.');
  }, { failure: 'The deletion result could not be confirmed. Check its status before trying again.' });
}
