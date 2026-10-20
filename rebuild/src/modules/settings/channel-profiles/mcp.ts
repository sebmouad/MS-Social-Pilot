import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { pageIdsFor, type McpToolGroup } from '@/server/mcp/kit';
import { changeChannelProfiles, readChannelProfiles } from './service';
const names = ['save_channel_group', 'delete_channel_group', 'set_channel_profile_labels'];
const id = { type: 'string', minLength: 1, maxLength: 200 };
export const CHANNEL_PROFILES_MCP: McpToolGroup = {
  id: 'settings-channel-profiles',
  tools: [
    { name: 'list_channel_profiles', description: 'List selected accessible channels with profile labels and group shortcuts. These labels are independent of post labels. Choose a currently authorized product feature.', inputSchema: { type: 'object', properties: { feature: { type: 'string', enum: ['settings/connections', 'publishing/posts', 'analytics/overview'] } }, additionalProperties: false } },
    { name: names[0]!, description: 'Create or replace a named channel group. Requires current workspace manager access. All group members must be selected and accessible. Confirmation: SAVE CHANNEL GROUP <id when editing, otherwise trimmed name>.', inputSchema: { type: 'object', required: ['name', 'channelIds', 'confirmation'], properties: { id, name: id, confirmation: { type: 'string' }, channelIds: { type: 'array', minItems: 1, maxItems: 10000, items: id } }, additionalProperties: false } },
    { name: names[1]!, description: 'Delete a channel group, retaining its channels and posts. Confirmation: DELETE CHANNEL GROUP <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id, confirmation: { type: 'string', maxLength: 300 } }, additionalProperties: false } },
    { name: names[2]!, description: 'Replace profile labels for one selected accessible channel. An empty list removes its labels. Confirmation: SET CHANNEL PROFILE LABELS <channelId>.', inputSchema: { type: 'object', required: ['channelId', 'labels', 'confirmation'], properties: { channelId: id, confirmation: { type: 'string' }, labels: { type: 'array', maxItems: 100, items: id } }, additionalProperties: false } },
  ],
  // Read authority is selected and revalidated by the service, including the key ceiling.
  features: { list_channel_profiles: 'settings/connections', save_channel_group: 'settings/connections', delete_channel_group: 'settings/connections', set_channel_profile_labels: 'settings/connections' },
  writeTools: names, selfLockedWrites: names,
  scope: { resourceTools: ['list_channel_profiles', ...names] },
  managers: [{ tools: new Set(names), message: 'Only workspace managers can edit channel profiles.', inExecutor: true }],
  execute: async (viewer, name, args) => {
    const actor = { userId: viewer.userId, workspaceId: viewer.workspaceId, allowedChannelIds: pageIdsFor(viewer) };
    if (name === 'list_channel_profiles') {
      const value = z.object({ feature: z.enum(['settings/connections', 'publishing/posts', 'analytics/overview']).default('settings/connections') }).strict().safeParse(args);
      if (!value.success) throw new OperationError('invalid_request', 'Choose a valid channel profile feature.');
      return readChannelProfiles(actor, value.data.feature);
    }
    const action = name === names[0] ? 'saveGroup' : name === names[1] ? 'deleteGroup' : name === names[2] ? 'setLabels' : null;
    if (!action || 'action' in args) throw new OperationError('invalid_request', 'Unknown channel profile action.');
    return changeChannelProfiles(actor, { ...args, action });
  },
};
