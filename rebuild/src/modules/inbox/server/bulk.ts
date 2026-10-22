import { inboxServiceText } from './service-copy';
import { runtimeConfig } from '@/server/config/store';
import { OperationError, isOperationErrorCode } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { authorizeInbox } from './access';
import { deleteInboxComment, moderateInboxComment, setInboxResolved } from './actions';
import { performInboxProductivityAction } from './productivity';
import { BULK_COMMENT_ONLY, BULK_MESSAGE_COMMENT_ONLY, bulkActionSchema, bulkConfirmation, type BulkInboxResult, type BulkItemResult } from '../bulk';
import { confirmation as singleConfirmation } from '../productivity';
import type { InboxReadActor, InboxReadConstraints } from './types';

const invalid = async () => new OperationError('invalid_request', await inboxServiceText('service10'));
/** The single-item route treats a reply without ok:true as an unconfirmed outcome; so does a bulk item. */
async function confirmed(result: unknown) {
  if (!result || typeof result !== 'object' || (result as { ok?: unknown }).ok !== true) throw new OperationError('upstream_failure', await inboxServiceText('service11'));
}

/**
 * Applies one moderation or assignment action to a bounded selection through the same per-item services as the
 * single-item controls (workflow, platform moderation, durable deletion, productivity assignment), so authorization,
 * channel scope, locks, audit and provider rules are not duplicated. Items run one after another; one item
 * failing never hides or undoes another, and every item reports its own outcome.
 */
export async function bulkInboxAction(actor: InboxReadActor, input: unknown, constraints: InboxReadConstraints = {}): Promise<BulkInboxResult> {
  const parsed = bulkActionSchema.safeParse(input);
  if (!parsed.success) throw await invalid();
  const { action, confirmation } = parsed.data;
  const cap = await runtimeConfig('inbox.bulkMaxItems');
  if (!Number.isSafeInteger(cap) || cap < 1) throw new OperationError('unavailable', await inboxServiceText('service12'));
  const seen = new Set<string>();
  const items = parsed.data.items.filter(item => { const key = `${item.kind}:${item.id}`; if (seen.has(key)) return false; seen.add(key); return true; });
  if (items.length > cap) throw new OperationError('invalid_request', await inboxServiceText('bulkLimit', { limit: cap }));
  if (action === 'assign') {
    // An omitted assignee is not an unassignment: null must be stated, so a truncated payload cannot clear owners.
    if (parsed.data.assigneeId === undefined) throw await invalid();
    if (confirmation !== bulkConfirmation(action, items.length, parsed.data.assigneeId)) throw await invalid();
  } else {
    if (parsed.data.assigneeId !== undefined) throw await invalid();
    if (confirmation !== bulkConfirmation(action, items.length)) throw await invalid();
  }
  if (BULK_COMMENT_ONLY.includes(action) && items.some(item => item.kind !== 'comment')) throw new OperationError('invalid_request', await inboxServiceText('service13'));
  if (BULK_MESSAGE_COMMENT_ONLY.includes(action) && items.some(item => item.kind !== 'message' && item.kind !== 'comment')) throw new OperationError('invalid_request', await inboxServiceText('assignKinds'));
  await authorizeInbox(actor, constraints, 'write');
  // The productivity service reads its channel ceiling from the actor, so the explicit bulk ceiling travels with it.
  const assignActor = constraints.allowedChannelIds === undefined ? actor : { ...actor, allowedChannelIds: constraints.allowedChannelIds };

  const results: BulkItemResult[] = [];
  for (const item of items) {
    try {
      let state: string | undefined;
      let assigneeId: string | null | undefined;
      if (action === 'resolve' || action === 'reopen') await confirmed(await setInboxResolved(actor, { kind: item.kind, id: item.id, resolved: action === 'resolve' }, constraints));
      else if (action === 'assign') {
        assigneeId = parsed.data.assigneeId ?? null;
        const receipt = await performInboxProductivityAction(assignActor, { action: 'assign', kind: item.kind, id: item.id, assigneeId, confirmation: singleConfirmation.assign(item.kind, item.id, assigneeId) });
        await confirmed(receipt);
      } else if (action === 'delete') {
        const receipt = await deleteInboxComment(actor, { id: item.id, confirmation: `DELETE COMMENT ${item.id}` }, constraints);
        state = typeof receipt?.state === 'string' ? receipt.state : undefined;
        // Deletion that is not fully confirmed stays a failure to the caller: it must be checked, never assumed or repeated.
        if (state !== undefined && state !== 'completed') { results.push({ kind: item.kind, id: item.id, ok: false, code: 'conflict', error: await inboxServiceText('deletionUnconfirmed') }); continue; }
      } else await confirmed(await withWorkspaceOperation(actor.workspaceId, () => moderateInboxComment(actor, { id: item.id, hidden: action === 'hide' }, constraints)));
      results.push({ kind: item.kind, id: item.id, ok: true, ...(state ? { state } : {}), ...(assigneeId !== undefined ? { assigneeId } : {}) });
    } catch (error) {
      const known = error instanceof OperationError;
      results.push({ kind: item.kind, id: item.id, ok: false, code: known && isOperationErrorCode(error.code) ? error.code : 'unavailable', error: known ? error.message : await inboxServiceText('updateFailed') });
    }
  }
  const succeeded = results.filter(result => result.ok).length;
  return { ok: true, action, requested: items.length, succeeded, failed: results.length - succeeded, results };
}
