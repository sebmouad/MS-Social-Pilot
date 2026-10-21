import { runtimeConfig } from '@/server/config/store';
import { OperationError, isOperationErrorCode } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { authorizeInbox } from './access';
import { deleteInboxComment, moderateInboxComment, setInboxResolved } from './actions';
import { BULK_COMMENT_ONLY, bulkActionSchema, bulkConfirmation, type BulkInboxResult, type BulkItemResult } from '../bulk';
import type { InboxReadActor, InboxReadConstraints } from './types';

const invalid = () => new OperationError('invalid_request', 'Choose the items and confirm this bulk action.');
/** The single-item route treats a reply without ok:true as an unconfirmed outcome; so does a bulk item. */
function confirmed(result: unknown) {
  if (!result || typeof result !== 'object' || (result as { ok?: unknown }).ok !== true) throw new OperationError('upstream_failure', 'The result was not confirmed. Check this item before trying again.');
}

/**
 * Applies one moderation action to a bounded selection through the same per-item services as the
 * single-item controls (workflow, platform moderation, durable deletion), so authorization, channel
 * scope, locks, audit and provider rules are not duplicated. Items run one after another; one item
 * failing never hides or undoes another, and every item reports its own outcome.
 */
export async function bulkInboxAction(actor: InboxReadActor, input: unknown, constraints: InboxReadConstraints = {}): Promise<BulkInboxResult> {
  const parsed = bulkActionSchema.safeParse(input);
  if (!parsed.success) throw invalid();
  const { action, confirmation } = parsed.data;
  const cap = await runtimeConfig('inbox.bulkMaxItems');
  if (!Number.isSafeInteger(cap) || cap < 1) throw new OperationError('unavailable', 'Bulk actions are currently unavailable.');
  const seen = new Set<string>();
  const items = parsed.data.items.filter(item => { const key = `${item.kind}:${item.id}`; if (seen.has(key)) return false; seen.add(key); return true; });
  if (items.length > cap) throw new OperationError('invalid_request', `Choose up to ${cap} items at a time.`);
  if (confirmation !== bulkConfirmation(action, items.length)) throw invalid();
  if (BULK_COMMENT_ONLY.includes(action) && items.some(item => item.kind !== 'comment')) throw new OperationError('invalid_request', 'Only comments can be hidden, shown again or deleted.');
  await authorizeInbox(actor, constraints, 'write');

  const results: BulkItemResult[] = [];
  for (const item of items) {
    try {
      let state: string | undefined;
      if (action === 'resolve' || action === 'reopen') confirmed(await setInboxResolved(actor, { kind: item.kind, id: item.id, resolved: action === 'resolve' }, constraints));
      else if (action === 'delete') {
        const receipt = await deleteInboxComment(actor, { id: item.id, confirmation: `DELETE COMMENT ${item.id}` }, constraints);
        state = typeof receipt?.state === 'string' ? receipt.state : undefined;
        // Deletion that is not fully confirmed stays a failure to the caller: it must be checked, never assumed or repeated.
        if (state !== undefined && state !== 'completed') { results.push({ kind: item.kind, id: item.id, ok: false, code: 'conflict', error: 'Deletion is not confirmed yet. Check this comment before trying again.' }); continue; }
      } else confirmed(await withWorkspaceOperation(actor.workspaceId, () => moderateInboxComment(actor, { id: item.id, hidden: action === 'hide' }, constraints)));
      results.push({ kind: item.kind, id: item.id, ok: true, ...(state ? { state } : {}) });
    } catch (error) {
      const known = error instanceof OperationError;
      results.push({ kind: item.kind, id: item.id, ok: false, code: known && isOperationErrorCode(error.code) ? error.code : 'unavailable', error: known ? error.message : 'This item could not be updated. Check it before trying again.' });
    }
  }
  const succeeded = results.filter(result => result.ok).length;
  return { ok: true, action, requested: items.length, succeeded, failed: results.length - succeeded, results };
}
