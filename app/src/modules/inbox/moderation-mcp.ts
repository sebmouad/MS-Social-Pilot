import { OperationError } from '@/lib/operation-error';
import { performInboxModerationAction, readInboxModeration } from './server/moderation';
import { MODERATION_ACTIONS, MODERATION_MATCHES } from './moderation';
import type { InboxReadActor } from './server/types';

const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' };
const rule = {
  type: 'object', additionalProperties: false,
  required: ['name', 'enabled', 'targetIds', 'match', 'keywords', 'action', 'replyText', 'dailyCap', 'oncePerUser'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 }, enabled: { type: 'boolean' },
    targetIds: { type: 'array', items: id, maxItems: 500, description: 'Channel IDs; empty means every channel (requires access to all channels).' },
    match: { type: 'string', enum: [...MODERATION_MATCHES] }, keywords: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 100 },
    action: { type: 'string', enum: [...MODERATION_ACTIONS] }, replyText: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    dailyCap: { type: 'integer', minimum: 1, maximum: 500 }, oncePerUser: { type: 'boolean' },
  },
};
export const inboxModerationTools = new Set(['get_inbox_moderation', 'create_inbox_moderation_rule', 'update_inbox_moderation_rule', 'delete_inbox_moderation_rule', 'run_inbox_moderation_rules', 'undo_inbox_moderation_action']);
export const inboxModerationWriteTools = new Set(['create_inbox_moderation_rule', 'update_inbox_moderation_rule', 'delete_inbox_moderation_rule', 'run_inbox_moderation_rules', 'undo_inbox_moderation_action']);
export const inboxModerationToolDefinitions = [
  { name: 'get_inbox_moderation', description: 'Read moderation rules and the latest moderation log for channels in your current scope.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'create_inbox_moderation_rule', description: 'Create a comment moderation rule. Confirmation: CREATE MODERATION RULE <name>.', inputSchema: { type: 'object', required: ['rule', 'confirmation'], properties: { rule, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'update_inbox_moderation_rule', description: 'Replace one visible moderation rule. Confirmation: UPDATE MODERATION RULE <id>.', inputSchema: { type: 'object', required: ['id', 'rule', 'confirmation'], properties: { id, rule, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_inbox_moderation_rule', description: 'Delete one visible moderation rule; its log stays. Confirmation: DELETE MODERATION RULE <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'run_inbox_moderation_rules', description: 'Check recent stored comments against enabled rules and hide/reply through the connected platform where it supports that. This contacts the remote platform. Confirmation: RUN MODERATION RULES <channelId|ALL>.', inputSchema: { type: 'object', required: ['channelId', 'confirmation'], properties: { channelId: { anyOf: [id, { type: 'null' }] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'undo_inbox_moderation_action', description: 'Show again a comment a rule hid. Contacts the remote platform. Confirmation: UNDO MODERATION ACTION <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id, confirmation: { type: 'string' } }, additionalProperties: false } },
];

export async function executeInboxModerationTool(actor: InboxReadActor, name: string, args: Record<string, unknown>) {
  if (name === 'get_inbox_moderation') {
    if (Object.keys(args).length) throw new OperationError('invalid_request', 'This tool takes no arguments.');
    return readInboxModeration(actor);
  }
  const action: Record<string, string> = { create_inbox_moderation_rule: 'rule.create', update_inbox_moderation_rule: 'rule.update', delete_inbox_moderation_rule: 'rule.delete', run_inbox_moderation_rules: 'rules.run', undo_inbox_moderation_action: 'action.undo' };
  if (!(name in action)) throw new OperationError('invalid_request', 'Unknown Inbox moderation action.');
  return performInboxModerationAction(actor, { ...args, action: action[name] });
}
