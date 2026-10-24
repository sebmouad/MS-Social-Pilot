import { changeConnectionDisconnect } from './server/connection-disconnect';
import { readConnectionDirectory } from './server/connection-directory';
import { OperationError } from '@/lib/operation-error';
import { previewSocialAccountDeletion } from '@/server/connection-mutations';
import { requiredString } from '@/server/mcp/kit';
import type { McpViewer } from '@/server/mcp/types';

const sourceId = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' };

export const connectionDirectoryToolDefinitions = [
  { name: 'list_connections', description: 'List connected sources for the workspace with credential state, reconnect advice and every discovered channel and ad account, including unselected ones. Use the returned ids with set_connection_selection and disconnect_connection. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
  { name: 'preview_connection_disconnect', description: 'Count the related records that disconnecting one source with data deletion would remove. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', required: ['socialAccountId'], properties: { socialAccountId: sourceId }, additionalProperties: false } },
  { name: 'disconnect_connection', description: 'Disconnect one source from this workspace. mode "retain" keeps related posts, conversations and metrics and only stops using the source; mode "delete" also removes them locally. This removes local credentials only and does not revoke access at the provider. Confirmation must be exactly DISCONNECT <socialAccountId> RETAIN or DISCONNECT <socialAccountId> DELETE RELATED DATA. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', required: ['socialAccountId', 'mode', 'confirmation'], properties: { socialAccountId: sourceId, mode: { type: 'string', enum: ['retain', 'delete'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;

export const connectionDirectoryTools = new Set<string>(connectionDirectoryToolDefinitions.map(tool => tool.name));
export const connectionDirectoryFeatures = Object.fromEntries([...connectionDirectoryTools].map(name => [name, 'settings/connections']));

/** Same loader and health summary as the Connections screen; credentials and scopes are never returned. */
export async function listConnectionDirectory(viewer: McpViewer, cap: number, input: unknown = {}) {
  return readConnectionDirectory({ userId: viewer.userId, workspaceId: viewer.workspaceId }, input, cap);
}

export async function executeConnectionDirectoryTool(viewer: McpViewer, name: string, args: Record<string, unknown>, cap: number) {
  const actor = { userId: viewer.userId, workspaceId: viewer.workspaceId };
  if (name === 'list_connections') return listConnectionDirectory(viewer, cap, args);
  if (name === 'disconnect_connection') return changeConnectionDisconnect(actor, args);
  const socialAccountId = requiredString(args, 'socialAccountId');
  if (name === 'preview_connection_disconnect') return { socialAccountId, counts: await previewSocialAccountDeletion(actor, socialAccountId) };
  throw new OperationError('invalid_request', `Unknown tool: ${name}`);
}
