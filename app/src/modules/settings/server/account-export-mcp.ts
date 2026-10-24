import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { accountSessionActor } from './account-session';
import { exportAccountData } from './account-export';

/** Register through Settings' module-owned mcp.ts; account-wide reads require a session. */
export const ACCOUNT_EXPORT_MCP: McpToolGroup = {
  id: 'settings-account-export',
  tools: [{ name: 'export_account_data', description: 'Download your profile, stored appearance and safe credential metadata as JSON. Coverage is explicitly partial; workspace content and secrets are excluded. Signed-in browser sessions only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }],
  features: { export_account_data: 'settings/account' },
  scope: { workspaceTools: ['export_account_data'] },
  available: async viewer => () => !viewer.apiKeyId,
  beforeCall: viewer => { if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session to export your account.'); },
  execute: async (viewer, name, args) => {
    if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session to export your account.');
    if (name !== 'export_account_data') throw new OperationError('invalid_request', 'Unknown account export action.');
    return exportAccountData(await accountSessionActor(viewer.userId, viewer.workspaceId), args);
  },
};
