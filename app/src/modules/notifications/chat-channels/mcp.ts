import { OperationError } from '@/lib/operation-error';
import { pageIdsFor, type McpToolGroup } from '@/server/mcp/kit';
import { CHAT_EVENTS, type ChatActor } from './contracts';
import { CHAT_CHANNELS_FEATURE } from './manifest';
import { createChatChannel, deleteChatChannel, listChatChannels, testChatChannel, updateChatChannel } from './server/service';

const str = { type: 'string', minLength: 1 };
const events = { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: CHAT_EVENTS } };
const object = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const chatToolDefinitions = [
  { name: 'list_chat_channels', description: 'List team chat destinations without credentials or raw delivery errors. Workspace owners/admins only.', inputSchema: object({}) },
  { name: 'create_chat_channel', description: 'Add Slack (url) or Telegram (botToken and chatId). Credentials are encrypted and never returned. Does not send until explicitly tested. Exact confirmation: CREATE CHAT CHANNEL <name>.', inputSchema: object({ kind: { type: 'string', enum: ['slack', 'telegram'] }, name: str, url: str, botToken: str, chatId: str, events, confirmation: str }, ['kind', 'name', 'events', 'confirmation']) },
  { name: 'update_chat_channel', description: 'Change enabled state or subscribed events. Exact confirmation: UPDATE CHAT CHANNEL <id>.', inputSchema: object({ id: str, enabled: { type: 'boolean' }, events, confirmation: str }, ['id', 'confirmation']) },
  { name: 'delete_chat_channel', description: 'Delete a workspace chat destination. Exact confirmation: DELETE CHAT CHANNEL <id>.', inputSchema: object({ id: str, confirmation: str }, ['id', 'confirmation']) },
  { name: 'test_chat_channel', description: 'Send one content-free test without automatic retries. An uncertain result requires checking the chat before another test. Exact confirmation: TEST CHAT CHANNEL <id>.', inputSchema: object({ id: str, confirmation: str }, ['id', 'confirmation']) },
] as const;
const names = chatToolDefinitions.map(tool => tool.name);
export async function executeChatTool(actor: ChatActor, name: string, input: unknown) {
  switch (name) {
    case 'list_chat_channels': return listChatChannels(actor);
    case 'create_chat_channel': return createChatChannel(actor, input);
    case 'update_chat_channel': return updateChatChannel(actor, input);
    case 'delete_chat_channel': return deleteChatChannel(actor, input);
    case 'test_chat_channel': return testChatChannel(actor, input);
    default: throw new OperationError('invalid_request', 'Choose a supported chat action.');
  }
}
export const CHAT_CHANNELS_MCP: readonly McpToolGroup[] = [{
  id: 'notifications-chat-channels', tools: chatToolDefinitions,
  features: Object.fromEntries(names.map(name => [name, CHAT_CHANNELS_FEATURE])),
  writeTools: names.filter(name => name !== 'list_chat_channels'), selfLockedWrites: names.filter(name => name !== 'list_chat_channels'),
  scope: { workspaceTools: names },
  managers: [{ tools: new Set(names), message: 'Only workspace owners and admins can manage chat destinations.', hideFromList: true, beforeArguments: true, inExecutor: true }],
  resources: [{ uri: 'msp://settings/chat-channels', name: 'Team chat destinations', description: 'Workspace chat destinations without credentials.', mimeType: 'application/json', feature: CHAT_CHANNELS_FEATURE, readTool: 'list_chat_channels', managerOnly: true, guardedRead: true }],
  execute: (viewer, name, args) => executeChatTool({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(viewer.resourceRestricted ? { allowedChannelIds: [] } : pageIdsFor(viewer) === undefined ? {} : { allowedChannelIds: pageIdsFor(viewer) }) }, name, args),
}];
