import { OperationError } from '@/lib/operation-error';
import { moderateInboxComment, replyToInbox, setInboxResolved } from '@/modules/inbox/server/actions';
import { auditedReceipt, inboxActor, pageIdsFor, requireConfirmation, requiredString, type McpToolGroup } from '@/server/mcp/kit';
import { deleteInboxCommentDurably, finishInboxDeletion, getInboxDeletion } from './server/deletion';
import { readInboxList, readInboxThread } from './server/read';
import { inboxProductivityToolDefinitions, executeInboxProductivityTool } from './productivity-mcp';
import { inboxModerationToolDefinitions, executeInboxModerationTool } from './moderation-mcp';

/** MCP tool groups this module installs. The host merges installed groups; edit only here. */
export const INBOX_MCP: readonly McpToolGroup[] = [
  {
    id: 'inbox-conversations',
    tools: [
    { name: 'list_inbox', description: 'Read the same merged, scoped Inbox activity as the app. Top-level comments and conversations have shared literal text/person search, channel/status/hidden filters and Older/Newer cursors. Root page and MCP result limits apply. Cursors reset when selection or filters change; activity can move when new messages arrive.', inputSchema: { type: 'object', properties: { channelId: { type: 'string' }, kind: { type: 'string', enum: ['all', 'comment', 'message', 'review'] }, state: { type: 'string', enum: ['open', 'resolved', 'all'] }, hidden: { type: 'string', enum: ['visible', 'all'] }, q: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
    { name: 'get_inbox_thread', description: 'Read one authorized stored Inbox thread by message:<id>, comment:<id> or review:<id>. Defaults to newest stored messages/replies displayed chronologically; follow history Older/Newer cursors. Original comment remains visible on every reply page. History does not imply all provider history was fetched.', inputSchema: { type: 'object', required: ['key'], properties: { key: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
    { name: 'reply_to_inbox', description: 'Send a reply to a synced conversation or comment through its connected platform. This contacts the remote platform. Reviews can be answered only where the channel module supports it. Confirmation must exactly match REPLY <message|comment|review> <id>.', inputSchema: { type: 'object', required: ['kind', 'id', 'text', 'confirmation'], properties: { kind: { type: 'string', enum: ['message', 'comment', 'review'] }, id: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 2000 }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'get_inbox_deletion', description: 'Read current scoped comment-deletion status without contacting the platform. Missing remote confirmation is not proof of deletion.', inputSchema: { type: 'object', required: ['itemId'], properties: { itemId: { type: 'string' } }, additionalProperties: false } },
    { name: 'delete_inbox_comment', description: 'Request permanent remote and local comment deletion once. Confirmation: DELETE COMMENT <id>. Read the returned state: only completed with remoteConfirmed and localConfirmed means deleted. Uncertain operations must be verified; repeating this tool never retries the remote call.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'finish_inbox_deletion', description: 'Complete only local cleanup after stored remote confirmation. Never contacts the platform. Confirmation: FINISH DELETION <operationId>.', inputSchema: { type: 'object', required: ['operationId', 'confirmation'], properties: { operationId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'set_inbox_resolved', description: 'Resolve or reopen a synced conversation, comment or review. Confirmation must exactly match RESOLVE <message|comment|review> <id> or REOPEN <message|comment|review> <id>.', inputSchema: { type: 'object', required: ['kind', 'id', 'resolved', 'confirmation'], properties: { kind: { type: 'string', enum: ['message', 'comment', 'review'] }, id: { type: 'string' }, resolved: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'moderate_inbox_comment', description: 'Hide or unhide a synced comment through its connected platform. This contacts the remote platform. Confirmation must exactly match HIDE COMMENT <id> or UNHIDE COMMENT <id>.', inputSchema: { type: 'object', required: ['id', 'hidden', 'confirmation'], properties: { id: { type: 'string' }, hidden: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    ],
    features: {
      list_inbox: 'inbox/conversations',
      get_inbox_thread: 'inbox/conversations',
      reply_to_inbox: 'inbox/conversations',
      get_inbox_deletion: 'inbox/conversations',
      delete_inbox_comment: 'inbox/conversations',
      finish_inbox_deletion: 'inbox/conversations',
      set_inbox_resolved: 'inbox/conversations',
      moderate_inbox_comment: 'inbox/conversations',
    },
    writeTools: ['reply_to_inbox', 'delete_inbox_comment', 'finish_inbox_deletion', 'set_inbox_resolved', 'moderate_inbox_comment'],
    selfLockedWrites: ['delete_inbox_comment', 'finish_inbox_deletion', 'set_inbox_resolved'],
    scope: { resourceTools: ['list_inbox', 'get_inbox_thread', 'reply_to_inbox', 'get_inbox_deletion', 'delete_inbox_comment', 'finish_inbox_deletion', 'set_inbox_resolved', 'moderate_inbox_comment'], resources: ['msp://inbox'] },
    resources: [
      { uri: 'msp://inbox', name: "Inbox", description: "Recent synced inbox activity.", mimeType: 'application/json', feature: 'inbox/conversations', readTool: 'list_inbox' },
    ],
    execute: async (viewer, name, args, cap) => {
      switch (name) {
      case 'list_inbox': {
        const { channels, ...result } = await readInboxList({ userId: viewer.userId, workspaceId: viewer.workspaceId }, args, { allowedChannelIds: pageIdsFor(viewer), maxItems: cap });
        return { ...result, channelCount: channels.length };
      }
      case 'get_inbox_thread': return readInboxThread({ userId: viewer.userId, workspaceId: viewer.workspaceId }, args, { allowedChannelIds: pageIdsFor(viewer), maxItems: cap });
      case 'reply_to_inbox': {
        const kind = args.kind === 'message' || args.kind === 'comment' || args.kind === 'review' ? args.kind : null;
        const id = typeof args.id === 'string' ? args.id : '';
        if (!kind || !id) throw new OperationError('invalid_request', 'kind and id are required.');
        requireConfirmation(args, `REPLY ${kind} ${id}`);
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        const result = await replyToInbox(inboxActor(viewer), { kind, id, text }, { allowedChannelIds: pageIdsFor(viewer) });
        return auditedReceipt(viewer, name, { kind, itemId: id }, { ...result, kind, itemId: id });
      }
      case 'get_inbox_deletion': {
        if (Object.keys(args).some(key => key !== 'itemId')) throw new OperationError('invalid_request', 'Choose one comment.');
        return getInboxDeletion(viewer, { itemId: requiredString(args, 'itemId') }, { allowedChannelIds: pageIdsFor(viewer) });
      }
      case 'delete_inbox_comment': {
        if (Object.keys(args).some(key => !['id', 'confirmation'].includes(key))) throw new OperationError('invalid_request', 'Choose one comment and confirm deletion.');
        const id = requiredString(args, 'id');
        requireConfirmation(args, `DELETE COMMENT ${id}`);
        const result = await deleteInboxCommentDurably(viewer, { id, confirmation: String(args.confirmation) }, { allowedChannelIds: pageIdsFor(viewer) });
        return auditedReceipt(viewer, name, { itemId: id, operationId: result.operationId, state: result.state }, result);
      }
      case 'finish_inbox_deletion': {
        if (Object.keys(args).some(key => !['operationId', 'confirmation'].includes(key))) throw new OperationError('invalid_request', 'Choose one deletion and confirm recovery.');
        const operationId = requiredString(args, 'operationId');
        requireConfirmation(args, `FINISH DELETION ${operationId}`);
        const result = await finishInboxDeletion(viewer, { operationId, confirmation: String(args.confirmation) }, { allowedChannelIds: pageIdsFor(viewer) });
        return auditedReceipt(viewer, name, { itemId: result.itemId, operationId, state: result.state }, result);
      }
      case 'set_inbox_resolved': {
        const kind = args.kind === 'message' || args.kind === 'comment' || args.kind === 'review' ? args.kind : null;
        const id = typeof args.id === 'string' ? args.id : '';
        if (!kind || !id || typeof args.resolved !== 'boolean') throw new OperationError('invalid_request', 'kind, id, and resolved are required.');
        const verb = args.resolved ? 'RESOLVE' : 'REOPEN';
        requireConfirmation(args, `${verb} ${kind} ${id}`);
        const result = await setInboxResolved(viewer, { kind, id, resolved: args.resolved }, { allowedChannelIds: pageIdsFor(viewer) });
        return auditedReceipt(viewer, name, { kind, itemId: id, resolved: args.resolved }, { ...result, kind, itemId: id, resolved: args.resolved });
      }
      case 'moderate_inbox_comment': {
        const id = typeof args.id === 'string' ? args.id : '';
        if (!id || typeof args.hidden !== 'boolean') throw new OperationError('invalid_request', 'id and hidden are required.');
        requireConfirmation(args, `${args.hidden ? 'HIDE' : 'UNHIDE'} COMMENT ${id}`);
        const result = await moderateInboxComment(inboxActor(viewer), { id, hidden: args.hidden }, { allowedChannelIds: pageIdsFor(viewer) });
        return auditedReceipt(viewer, name, { itemId: id, hidden: args.hidden }, { ...result, itemId: id, hidden: args.hidden });
      }
        default: throw new OperationError('invalid_request', `Unknown tool: ${name}`);
      }
    },
  },
  {
    id: 'inbox-productivity',
    tools: inboxProductivityToolDefinitions,
    features: {
      get_inbox_productivity: 'inbox/conversations',
      list_inbox_saved_replies: 'inbox/conversations',
      assign_inbox_item: 'inbox/conversations',
      add_inbox_private_note: 'inbox/conversations',
      delete_inbox_private_note: 'inbox/conversations',
      create_inbox_saved_reply: 'inbox/conversations',
      update_inbox_saved_reply: 'inbox/conversations',
      delete_inbox_saved_reply: 'inbox/conversations',
    },
    writeTools: ['assign_inbox_item', 'add_inbox_private_note', 'delete_inbox_private_note', 'create_inbox_saved_reply', 'update_inbox_saved_reply', 'delete_inbox_saved_reply'],
    selfLockedWrites: ['assign_inbox_item', 'add_inbox_private_note', 'delete_inbox_private_note', 'create_inbox_saved_reply', 'update_inbox_saved_reply', 'delete_inbox_saved_reply'],
    scope: { resourceTools: ['get_inbox_productivity', 'assign_inbox_item', 'add_inbox_private_note', 'delete_inbox_private_note'], workspaceTools: ['list_inbox_saved_replies', 'create_inbox_saved_reply', 'update_inbox_saved_reply', 'delete_inbox_saved_reply'] },
    execute: (viewer, name, args, cap) => executeInboxProductivityTool(inboxActor(viewer), name, args, cap),
  },
  {
    id: 'inbox-moderation',
    tools: inboxModerationToolDefinitions,
    features: {
      get_inbox_moderation: 'inbox/conversations',
      create_inbox_moderation_rule: 'inbox/conversations',
      update_inbox_moderation_rule: 'inbox/conversations',
      delete_inbox_moderation_rule: 'inbox/conversations',
      run_inbox_moderation_rules: 'inbox/conversations',
      undo_inbox_moderation_action: 'inbox/conversations',
    },
    writeTools: ['create_inbox_moderation_rule', 'update_inbox_moderation_rule', 'delete_inbox_moderation_rule', 'run_inbox_moderation_rules', 'undo_inbox_moderation_action'],
    selfLockedWrites: ['create_inbox_moderation_rule', 'update_inbox_moderation_rule', 'delete_inbox_moderation_rule', 'run_inbox_moderation_rules', 'undo_inbox_moderation_action'],
    scope: { resourceTools: ['get_inbox_moderation', 'create_inbox_moderation_rule', 'update_inbox_moderation_rule', 'delete_inbox_moderation_rule', 'run_inbox_moderation_rules', 'undo_inbox_moderation_action'] },
    execute: (viewer, name, args) => executeInboxModerationTool(inboxActor(viewer), name, args),
  },
];
