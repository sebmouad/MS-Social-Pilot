import { OperationError } from '@/lib/operation-error';
import type { InboxReadActor } from './server/types';
import { createInboxSavedView, deleteInboxSavedView, listInboxSavedViews } from './server/saved-views';

export const inboxSavedViewToolDefinitions = [
  { name: 'list_inbox_saved_views', description: 'List your own saved Inbox filter views in the current workspace. Each view returns a relative address; opening it re-applies your current channel access.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'create_inbox_saved_view', description: 'Save your current Inbox filters (type, status, hidden, text, quick) as a named personal view. No confirmation is required; a view stores filters only and grants nothing.', inputSchema: { type: 'object', required: ['name', 'query'], properties: { name: { type: 'string', minLength: 1, maxLength: 60 }, query: { type: 'string', maxLength: 1500, description: 'URL query string of Inbox filters, for example type=comment&status=open' } }, additionalProperties: false } },
  { name: 'delete_inbox_saved_view', description: 'Delete one of your own saved Inbox views. Confirmation must exactly match DELETE INBOX SAVED VIEW <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export async function executeInboxSavedViewTool(actor: InboxReadActor, name: string, args: Record<string, unknown>) {
  if (name === 'list_inbox_saved_views') return listInboxSavedViews(actor);
  if (name === 'create_inbox_saved_view') return createInboxSavedView(actor, args ?? {});
  if (name === 'delete_inbox_saved_view') return deleteInboxSavedView(actor, args ?? {});
  throw new OperationError('invalid_request', 'Unknown Inbox saved view action.');
}
