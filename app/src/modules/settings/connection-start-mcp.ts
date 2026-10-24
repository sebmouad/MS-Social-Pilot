import { cookies } from 'next/headers';
import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { runtimeConfig } from '@/server/config/store';
import { accountSessionActor } from './server/account-session';
import { startConnection } from './server/connection-start';

export const CONNECTION_START_MCP: McpToolGroup = {
  id: 'settings-connection-start',
  tools: [{ name: 'start_connection', description: 'Start connecting an installed platform account. Returns the authorization URL to open in this signed-in browser; consent is completed at the provider. Browser sessions only. Confirmation: START CONNECTION <platform>.', inputSchema: { type: 'object', properties: { platform: { type: 'string' }, confirmation: { type: 'string' } }, required: ['platform', 'confirmation'], additionalProperties: false } }],
  features: { start_connection: 'settings/connections' },
  writeTools: ['start_connection'], selfLockedWrites: ['start_connection'],
  scope: { workspaceTools: ['start_connection'] },
  available: async viewer => () => !viewer.apiKeyId,
  beforeCall: viewer => { if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session to connect an account.'); },
  execute: async (viewer, name, args) => {
    if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session to connect an account.');
    if (name !== 'start_connection') throw new OperationError('invalid_request', 'Unknown connection action.');
    // No client-supplied or Host-derived origin is trusted for OAuth redirects.
    const origin = await runtimeConfig('app.publicOrigin');
    if (!origin) throw new OperationError('unavailable', 'Connection unavailable. Try again or contact support.');
    const actor = await accountSessionActor(viewer.userId, viewer.workspaceId);
    const response = await startConnection(actor, args, new Request(new URL('/api/oauth/connections/start', origin), { method: 'POST', headers: { origin } }));
    const jar = await cookies();
    for (const cookie of response.cookies.getAll()) jar.set(cookie);
    const { authorizationUrl } = await response.json();
    return { authorizationUrl };
  },
};
