import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { accountSessionActor } from './server/account-session';
import { connectWithCredentials, readConnectionCredentialForm } from './server/connection-credentials';

const BROWSER_ONLY = 'Use a signed-in browser session to connect an account.';
/** Credential-entry connections (app password, bot token) for platforms without a redirect flow. Browser sessions only. */
export const CONNECTION_CREDENTIALS_MCP: McpToolGroup = {
  id: 'settings-connection-credentials',
  tools: [
    { name: 'get_connection_credential_form', description: 'Describe the credential fields (for example app password or bot token) an installed platform needs. Browser sessions only. Optional locale en or fr.', inputSchema: { type: 'object', properties: { platform: { type: 'string' }, locale: { type: 'string', enum: ['en', 'fr'] } }, required: ['platform'], additionalProperties: false } },
    { name: 'connect_with_credentials', description: 'Verify and store a credential for a platform connected by entering it (not by redirect). Secrets are encrypted and never returned; discovered channels still need selection. Browser sessions only. Confirmation: CONNECT WITH CREDENTIALS <platform>.', inputSchema: { type: 'object', properties: { platform: { type: 'string' }, fields: { type: 'object', additionalProperties: { type: 'string', maxLength: 4096 } }, confirmation: { type: 'string' } }, required: ['platform', 'fields', 'confirmation'], additionalProperties: false } },
  ],
  features: { get_connection_credential_form: 'settings/connections', connect_with_credentials: 'settings/connections' },
  writeTools: ['connect_with_credentials'], selfLockedWrites: ['connect_with_credentials'],
  scope: { workspaceTools: ['get_connection_credential_form', 'connect_with_credentials'] },
  available: async viewer => () => !viewer.apiKeyId,
  beforeCall: viewer => { if (viewer.apiKeyId) throw new OperationError('forbidden', BROWSER_ONLY); },
  execute: async (viewer, name, args) => {
    if (viewer.apiKeyId) throw new OperationError('forbidden', BROWSER_ONLY);
    const actor = await accountSessionActor(viewer.userId, viewer.workspaceId);
    if (name === 'get_connection_credential_form') {
      if (typeof args.platform !== 'string' || Object.keys(args).some(key => key !== 'platform' && key !== 'locale')) throw new OperationError('invalid_request', 'Choose a platform.');
      return readConnectionCredentialForm(actor, args.platform, args.locale === 'fr' ? 'fr' : 'en');
    }
    if (name === 'connect_with_credentials') return connectWithCredentials(actor, args);
    throw new OperationError('invalid_request', 'Unknown connection action.');
  },
};
