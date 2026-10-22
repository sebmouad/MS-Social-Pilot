import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { HISTORY_FEATURE_ID, HISTORY_TOOL_ACCESS } from './semantics';
import { listWorkspaceActivity, listWorkspaceEmails } from './server/history';

export const historyTools = new Set(Object.keys(HISTORY_TOOL_ACCESS));
const paging = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1 } };

export const historyToolDefinitions = [
  { name: 'list_workspace_activity', description: 'Newest-first workspace activity log: who did what and when. Optional q matches the action code. Results are paged: continue with offset while hasMore is true. Workspace owners and admins only. Secrets are never returned.', inputSchema: { type: 'object', properties: { q: { type: 'string', maxLength: 500 }, ...paging }, additionalProperties: false } },
  { name: 'list_workspace_email_log', description: 'Newest-first emails sent for this workspace with delivery status, plus the count of recent undelivered emails. Optional q matches recipient or subject; problemsOnly keeps undelivered ones. Paged with offset/hasMore. Workspace owners and admins only.', inputSchema: { type: 'object', properties: { q: { type: 'string', maxLength: 500 }, problemsOnly: { type: 'boolean' }, ...paging }, additionalProperties: false } },
];

/** MCP tool group this module installs. The host merges installed groups; edit only here. */
export const HISTORY_MCP: readonly McpToolGroup[] = [
  {
    id: 'history',
    tools: historyToolDefinitions,
    features: { list_workspace_activity: HISTORY_FEATURE_ID, list_workspace_email_log: HISTORY_FEATURE_ID },
    scope: { workspaceTools: ['list_workspace_activity', 'list_workspace_email_log'] },
    managers: [{ tools: historyTools, message: 'Only workspace owners and admins can read history.', hideFromList: true, beforeArguments: true, inExecutor: true }],
    resources: [
      { uri: 'msp://settings/history', name: 'Workspace activity', description: 'First bounded page of workspace activity; owners and admins only. Continue with list_workspace_activity.', mimeType: 'application/json', feature: HISTORY_FEATURE_ID, readTool: 'list_workspace_activity', managerOnly: true },
    ],
    execute: async (viewer, name, args, cap) => {
      const actor = { userId: viewer.userId, workspaceId: viewer.workspaceId, ...(viewer.permissions ? { permissionCeiling: viewer.permissions } : {}) };
      if (name === 'list_workspace_activity') return listWorkspaceActivity(actor, args, cap);
      if (name === 'list_workspace_email_log') return listWorkspaceEmails(actor, args, cap);
      throw new OperationError('not_found', 'Unknown tool.');
    },
  },
];
