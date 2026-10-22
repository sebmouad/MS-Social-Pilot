import { OperationError } from '@/lib/operation-error';
import type { IntegrationsActor } from './contracts';
import { readNotifications, updateNotifications } from './server/notifications';
import { revokeApiToken, listApiTokens } from './server/tokens';
import { createWebhook, deleteWebhook, listDeliveries, listWebhooks, redeliverWebhook, rotateWebhookSecret, testWebhook, updateWebhook } from './server/webhooks';
import { NOTIFICATION_FLAGS, MUTE_EVENTS, WEBHOOK_EVENTS } from './contracts';

const id = { type: 'string', minLength: 1, maxLength: 80 } as const;
const confirmation = { type: 'string', description: 'Exact confirmation text named in the tool description.' } as const;
const obj = (properties: object, required: string[] = []) => ({ type: 'object', required, properties, additionalProperties: false }) as const;
const events = { type: 'array', items: { type: 'string', enum: [...WEBHOOK_EVENTS] }, minItems: 1 } as const;

/**
 * MCP tools for notifications, outbound webhooks and API keys. Not wired: the MCP host registers and routes them.
 * API key creation and OAuth consent are intentionally absent: they return bearer credentials into an agent transcript and
 * would let one credential mint another. Create keys in Settings.
 */
export const integrationsToolDefinitions = [
  { name: 'get_notification_preferences', description: 'Your alert choices in this workspace (defaults apply until you save), your muted channels, and the channels you can mute.', inputSchema: obj({}) },
  { name: 'update_notification_preferences', description: `Change any of ${NOTIFICATION_FLAGS.join(', ')} and/or replace your muted channels (mutes: [{targetId, event: ${MUTE_EVENTS.join('|')}}]). Confirmation must exactly match "UPDATE NOTIFICATION PREFERENCES".`, inputSchema: obj({ ...Object.fromEntries(NOTIFICATION_FLAGS.map(flag => [flag, { type: 'boolean' }])), mutes: { type: 'array', items: obj({ targetId: id, event: { type: 'string', enum: [...MUTE_EVENTS] } }, ['targetId', 'event']) }, confirmation }, ['confirmation']) },
  { name: 'list_webhooks', description: 'Outbound webhook endpoints of this workspace with status and pending/failed delivery counts. Workspace owners and admins only. Secrets are never returned.', inputSchema: obj({}) },
  { name: 'create_webhook', description: 'Add an endpoint that receives signed JSON events at a public https address. Returns the signing secret once. Confirmation must exactly match "CREATE WEBHOOK <name>".', inputSchema: obj({ name: { type: 'string' }, url: { type: 'string' }, events, confirmation }, ['name', 'url', 'events', 'confirmation']) },
  { name: 'update_webhook', description: 'Enable/disable an endpoint or change its events. Confirmation must exactly match "UPDATE WEBHOOK <id>".', inputSchema: obj({ id, enabled: { type: 'boolean' }, events, confirmation }, ['id', 'confirmation']) },
  { name: 'delete_webhook', description: 'Delete an endpoint and its delivery history. Confirmation must exactly match "DELETE WEBHOOK <id>".', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
  { name: 'rotate_webhook_secret', description: 'Replace the signing secret (the old one stops signing at once). Returns the new secret once. Confirmation must exactly match "ROTATE WEBHOOK SECRET <id>".', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
  { name: 'test_webhook', description: 'Send one signed ping now, without retries, and report the receiver answer. Confirmation must exactly match "TEST WEBHOOK <id>".', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
  { name: 'list_webhook_deliveries', description: 'Delivery history of an endpoint, newest first.', inputSchema: obj({ id, page: { type: 'integer', minimum: 1 } }, ['id']) },
  { name: 'redeliver_webhook_delivery', description: 'Send a settled delivery again now (same delivery id so receivers can de-duplicate). Confirmation must exactly match "REDELIVER WEBHOOK DELIVERY <deliveryId>".', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
  { name: 'list_api_keys', description: 'REST API keys of this workspace: prefix, access level, channels, expiry, last use, status. Key values are never shown. Owners and admins only.', inputSchema: obj({}) },
  { name: 'revoke_api_key', description: 'Revoke an API key and turn off the webhooks it subscribed. Confirmation must exactly match "REVOKE API KEY <id>".', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
] as const;

export const integrationsTools = new Set<string>(integrationsToolDefinitions.map(tool => tool.name));
export const integrationsWriteTools = new Set<string>(['update_notification_preferences', 'create_webhook', 'update_webhook', 'delete_webhook', 'rotate_webhook_secret', 'test_webhook', 'redeliver_webhook_delivery', 'revoke_api_key']);

export async function executeIntegrationsTool(actor: IntegrationsActor, name: string, args: unknown) {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'get_notification_preferences': return readNotifications(actor);
    case 'update_notification_preferences': return updateNotifications(actor, args);
    case 'list_webhooks': return listWebhooks(actor);
    case 'create_webhook': return createWebhook(actor, args);
    case 'update_webhook': return updateWebhook(actor, args);
    case 'delete_webhook': return deleteWebhook(actor, args);
    case 'rotate_webhook_secret': return rotateWebhookSecret(actor, args);
    case 'test_webhook': return testWebhook(actor, args);
    case 'list_webhook_deliveries': return listDeliveries(actor, a);
    case 'redeliver_webhook_delivery': return redeliverWebhook(actor, args);
    case 'list_api_keys': return listApiTokens(actor);
    case 'revoke_api_key': return revokeApiToken(actor, args);
    default: throw new OperationError('invalid_request', 'Choose a supported integrations action.');
  }
}
