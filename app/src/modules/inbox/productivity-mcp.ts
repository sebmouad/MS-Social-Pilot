import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { listSavedReplies, performInboxProductivityAction, readInboxProductivity } from './server/productivity';
import type { InboxReadActor } from './server/types';

const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' };
const kind = { type: 'string', enum: ['message', 'comment'] };
const item = { kind, id };
export const inboxProductivityTools = new Set(['get_inbox_productivity', 'list_inbox_saved_replies', 'assign_inbox_item', 'add_inbox_private_note', 'delete_inbox_private_note', 'create_inbox_saved_reply', 'update_inbox_saved_reply', 'delete_inbox_saved_reply']);
export const inboxProductivityWriteTools = new Set(['assign_inbox_item', 'add_inbox_private_note', 'delete_inbox_private_note', 'create_inbox_saved_reply', 'update_inbox_saved_reply', 'delete_inbox_saved_reply']);
export const inboxProductivityToolDefinitions = [
  { name: 'get_inbox_productivity', description: 'Read assignment, current active assignees, private notes and mentionable teammates for an Inbox item visible to your current channel scope.', inputSchema: { type: 'object', required: ['kind','id'], properties: item, additionalProperties: false } },
  { name: 'list_inbox_saved_replies', description: 'Read workspace saved replies with bounded offset pagination.', inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 1000 }, q: { type: 'string', maxLength: 200 } }, additionalProperties: false } },
  { name: 'assign_inbox_item', description: 'Assign a visible Inbox item to an active workspace member or unassign it. Confirmation: ASSIGN INBOX <kind> <id> TO <memberId|UNASSIGNED>. Channel access is rechecked.', inputSchema: { type: 'object', required: ['kind','id','assigneeId','confirmation'], properties: { ...item, assigneeId: { anyOf: [id, { type: 'null' }] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'add_inbox_private_note', description: 'Append a private team note to a visible Inbox item. Optional mentionIds (from get_inbox_productivity mentionable) notify teammates who can see the channel, but only when their @name is really in the body; self-mentions never notify. Confirmation: ADD PRIVATE NOTE <kind> <id>. Note body is never included in audit records.', inputSchema: { type: 'object', required: ['kind','id','body','confirmation'], properties: { ...item, body: { type: 'string', minLength: 1, maxLength: 10000 }, mentionIds: { type: 'array', items: id }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_inbox_private_note', description: 'Remove your own note, or any note as a workspace owner/admin. Confirmation: DELETE PRIVATE NOTE <noteId>.', inputSchema: { type: 'object', required: ['id','confirmation'], properties: { id, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'create_inbox_saved_reply', description: 'Create a reusable private workspace reply. Confirmation: CREATE SAVED REPLY <name>. Body is not written to audit records.', inputSchema: { type: 'object', required: ['name','body','confirmation'], properties: { name: { type: 'string' }, body: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'update_inbox_saved_reply', description: 'Update one workspace saved reply. Confirmation: UPDATE SAVED REPLY <id>.', inputSchema: { type: 'object', required: ['id','name','body','confirmation'], properties: { id, name: { type: 'string' }, body: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_inbox_saved_reply', description: 'Delete one workspace saved reply. Confirmation: DELETE SAVED REPLY <id>.', inputSchema: { type: 'object', required: ['id','confirmation'], properties: { id, confirmation: { type: 'string' } }, additionalProperties: false } },
];

export async function executeInboxProductivityTool(actor: InboxReadActor, name: string, args: Record<string, unknown>, cap: number) {
  if (name === 'get_inbox_productivity') return readInboxProductivity(actor, args);
  if (name === 'list_inbox_saved_replies') {
    const checked = z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().positive().optional(), q: z.string().max(200).default('') }).strict().safeParse(args);
    if (!checked.success || !Number.isSafeInteger(cap) || cap < 1) throw new OperationError('invalid_request', 'Choose valid saved reply paging values.');
    return listSavedReplies(actor, { ...checked.data, limit: Math.min(checked.data.limit ?? cap, cap) });
  }
  const actions: Record<string, unknown> = {
    assign_inbox_item: { ...args, action: 'assign' }, add_inbox_private_note: { ...args, action: 'note.add' }, delete_inbox_private_note: { ...args, action: 'note.delete' },
    create_inbox_saved_reply: { ...args, action: 'reply.create' }, update_inbox_saved_reply: { ...args, action: 'reply.update' }, delete_inbox_saved_reply: { ...args, action: 'reply.delete' },
  };
  if (!(name in actions)) throw new OperationError('invalid_request', 'Unknown Inbox productivity action.');
  return performInboxProductivityAction(actor, actions[name]);
}
