import type { McpToolGroup } from '@/server/mcp/kit';
import { OperationError } from '@/lib/operation-error';
import { accountSessionActor } from '../server/account-session';
import { INSTALL_CONFIRMATION, readWebApp, prepareWebApp } from './service';
export const WEB_APP_MCP: McpToolGroup = {
  id: 'settings-web-app',
  tools: [
    { name: 'get_web_app', description: 'Read public app branding and installation policy through your account session. Installation itself needs a browser ceremony.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'prepare_web_app_installation', description: `Prepare and audit a request to install the app. Does not install anything remotely; finish through your browser. Confirmation: ${INSTALL_CONFIRMATION}. Browser session required.`, inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string', const: INSTALL_CONFIRMATION } }, additionalProperties: false } },
  ],
  features: { get_web_app: 'settings/appearance', prepare_web_app_installation: 'settings/appearance' },
  writeTools: ['prepare_web_app_installation'], selfLockedWrites: ['prepare_web_app_installation'],
  scope: { workspaceTools: ['get_web_app', 'prepare_web_app_installation'] },
  available: async viewer => () => !viewer.apiKeyId,
  beforeCall: viewer => { if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session.'); },
  execute: async (viewer, name, args) => {
    if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session.');
    const actor = await accountSessionActor(viewer.userId, viewer.workspaceId);
    if (name === 'get_web_app') return readWebApp(actor);
    if (name === 'prepare_web_app_installation') return prepareWebApp(actor, args);
    throw new OperationError('invalid_request', 'Choose a supported app action.');
  },
};
