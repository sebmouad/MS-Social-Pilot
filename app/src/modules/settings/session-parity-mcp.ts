import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { THEMES, MODES } from '@/lib/themes';
import { accountSessionActor } from './server/account-session';
import { appearanceSession } from './server/appearance';
import { webhookSecretAction } from './server/webhook-secrets';
const string = { type: 'string' };
const secretProperties = { id: string, confirmation: string };
export const SESSION_PARITY_MCP: McpToolGroup = {
  id: 'settings-session-parity',
  tools: [
    { name: 'get_appearance', description: 'Read your saved account theme and this browser’s display mode. Mode is cookie-only. Browser session required.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'update_appearance', description: 'Save your account theme and browser display mode. Confirmation: UPDATE APPEARANCE. Browser session required.', inputSchema: { type: 'object', required: ['theme', 'mode', 'confirmation'], properties: { theme: { type: 'string', enum: THEMES.map(t => t.id) }, mode: { type: 'string', enum: MODES.map(m => m.id) }, confirmation: string }, additionalProperties: false } },
    { name: 'reveal_webhook_secret', description: 'Show a webhook signing secret in this response only. Not included in lists or audit. Every reveal is confirmed, audited and rate limited. Confirmation: REVEAL WEBHOOK SECRET <id>. Browser session required; bearer keys cannot reveal secrets.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: secretProperties, additionalProperties: false } },
    { name: 'rotate_webhook_secret_once', description: 'Replace a signing secret and return the new secret once. The old secret immediately stops signing. Confirmation: ROTATE WEBHOOK SECRET <id>. Browser session required; existing bearer rotation tools remain secret-free.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: secretProperties, additionalProperties: false } },
  ],
  features: { get_appearance: 'settings/appearance', update_appearance: 'settings/appearance', reveal_webhook_secret: 'settings/webhooks', rotate_webhook_secret_once: 'settings/webhooks' },
  writeTools: ['update_appearance', 'reveal_webhook_secret', 'rotate_webhook_secret_once'],
  selfLockedWrites: ['update_appearance', 'reveal_webhook_secret', 'rotate_webhook_secret_once'],
  scope: { workspaceTools: ['get_appearance', 'update_appearance', 'reveal_webhook_secret', 'rotate_webhook_secret_once'] },
  available: async viewer => () => !viewer.apiKeyId,
  beforeCall: viewer => { if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session.'); },
  execute: async (viewer, name, args) => {
    if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session.');
    const actor = await accountSessionActor(viewer.userId, viewer.workspaceId);
    if (name === 'get_appearance') return appearanceSession(actor);
    if (name === 'update_appearance') return appearanceSession(actor, args);
    if (name === 'reveal_webhook_secret') return webhookSecretAction(actor, args, 'reveal');
    if (name === 'rotate_webhook_secret_once') return webhookSecretAction(actor, args, 'rotate');
    throw new OperationError('invalid_request', 'Choose a supported Settings action.');
  },
};
