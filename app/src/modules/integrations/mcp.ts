import { OperationError } from '@/lib/operation-error';
import { auditedReceipt, canManageData, type McpToolGroup } from '@/server/mcp/kit';
import { WEBHOOK_EVENTS } from './contracts';
import { INTEGRATIONS_INPUT_HARD_MAX } from './config';
import { WEBHOOKS_FEATURE_ID } from './manifest';
import { createWebhook, deleteWebhook, listDeliveries, listWebhooks, redeliverWebhook, rotateWebhookSecret, testWebhook, updateWebhook } from './server/webhooks';

// Advertise the parser ceiling; owning services enforce current Root limits.
const id = { type: 'string', minLength: 1, maxLength: INTEGRATIONS_INPUT_HARD_MAX } as const;
const confirmation = { type: 'string', description: 'Exact confirmation text named in the tool description.' } as const;
const obj = (properties: object, required: string[] = []) => ({ type: 'object', required, properties, additionalProperties: false }) as const;
const events = { type: 'array', items: { type: 'string', enum: [...WEBHOOK_EVENTS] }, minItems: 1 } as const;

/**
 * MCP tools for outbound webhooks. Signing secrets are never returned over MCP (an agent transcript is not a safe place for them):
 * create and rotate succeed and the secret is shown in Settings > Webhooks. API key issuance and OAuth consent are not tools either:
 * they would let one credential mint another. All tools are workspace-wide, so a key restricted to selected channels cannot use them.
 */
export const integrationsToolDefinitions = [
  { name: 'list_webhooks', description: 'Outbound webhook endpoints of this workspace with status and pending/failed delivery counts. Workspace owners and admins only. Addresses are shortened and secrets are never returned.', inputSchema: obj({}) },
  { name: 'create_webhook', description: 'Add an endpoint that receives signed JSON events at a public https address. The signing secret is not returned here; show it in Settings > Webhooks. Confirmation must exactly match "CREATE WEBHOOK <name>".', inputSchema: obj({ name: { type: 'string', maxLength: INTEGRATIONS_INPUT_HARD_MAX }, url: { type: 'string', maxLength: INTEGRATIONS_INPUT_HARD_MAX }, events, confirmation }, ['name', 'url', 'events', 'confirmation']) },
  { name: 'update_webhook', description: 'Enable/disable an endpoint or change its events. Confirmation must exactly match "UPDATE WEBHOOK <id>".', inputSchema: obj({ id, enabled: { type: 'boolean' }, events, confirmation }, ['id', 'confirmation']) },
  { name: 'delete_webhook', description: 'Delete an endpoint and its delivery history. Confirmation must exactly match "DELETE WEBHOOK <id>".', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
  { name: 'rotate_webhook_secret', description: 'Replace the signing secret (the old one stops signing at once). The new secret is not returned here; show it in Settings > Webhooks. Confirmation must exactly match "ROTATE WEBHOOK SECRET <id>".', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
  { name: 'test_webhook', description: 'Send one signed ping now, without retries, and report the receiver answer. Confirmation must exactly match "TEST WEBHOOK <id>".', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
  { name: 'list_webhook_deliveries', description: 'Delivery history of an endpoint, newest first.', inputSchema: obj({ id, page: { type: 'integer', minimum: 1 } }, ['id']) },
  { name: 'redeliver_webhook_delivery', description: 'Send a settled delivery again now (same delivery id so receivers can de-duplicate). The id is the delivery id. Confirmation must exactly match "REDELIVER WEBHOOK DELIVERY <id>".', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
] as const;

export const integrationsTools = new Set<string>(integrationsToolDefinitions.map(tool => tool.name));
export const integrationsWriteTools = new Set<string>(['create_webhook', 'update_webhook', 'delete_webhook', 'rotate_webhook_secret', 'test_webhook', 'redeliver_webhook_delivery']);

type Actor = { userId: string; workspaceId: string };
export async function executeIntegrationsTool(actor: Actor, name: string, args: unknown) {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'list_webhooks': return listWebhooks(actor);
    case 'create_webhook': { const { secret: _secret, secretNotice: _notice, ...created } = await createWebhook(actor, args); return { ...created, secretNotice: 'The signing secret was created. Show it in Settings > Webhooks.' }; }
    case 'update_webhook': return updateWebhook(actor, args);
    case 'delete_webhook': return deleteWebhook(actor, args);
    case 'rotate_webhook_secret': { const { secret: _secret, secretNotice: _notice, ...rotated } = await rotateWebhookSecret(actor, args); return { ...rotated, secretNotice: 'The signing secret was replaced. Show the new one in Settings > Webhooks.' }; }
    case 'test_webhook': return testWebhook(actor, args);
    case 'list_webhook_deliveries': return listDeliveries(actor, a);
    case 'redeliver_webhook_delivery': return redeliverWebhook(actor, args);
    default: throw new OperationError('invalid_request', 'Choose a supported webhook action.');
  }
}

export const INTEGRATIONS_MCP: readonly McpToolGroup[] = [{
  id: 'integrations-webhooks',
  tools: integrationsToolDefinitions,
  features: Object.fromEntries(integrationsToolDefinitions.map(tool => [tool.name, WEBHOOKS_FEATURE_ID])),
  writeTools: [...integrationsWriteTools],
  // Services that change data own their workspace lock; test and redeliver send from the call and use the outer lock.
  selfLockedWrites: ['create_webhook', 'update_webhook', 'delete_webhook', 'rotate_webhook_secret'],
  scope: { workspaceTools: [...integrationsTools] },
  managers: [{ tools: integrationsTools, message: 'Only workspace owners and admins can manage webhooks.', hideFromList: true, beforeArguments: true, inExecutor: true }],
  resources: [
    { uri: 'msp://settings/webhooks', name: 'Webhooks', description: 'Outbound webhook endpoints with status. Secrets are never included.', mimeType: 'application/json', feature: WEBHOOKS_FEATURE_ID, readTool: 'list_webhooks', managerOnly: true, guardedRead: true },
  ],
  execute: async (viewer, name, args) => {
    if (!canManageData(viewer)) throw new OperationError('forbidden', 'Only workspace owners and admins can manage webhooks.');
    const actor: Actor = { userId: viewer.userId, workspaceId: viewer.workspaceId };
    const result = await executeIntegrationsTool(actor, name, args);
    if (!integrationsWriteTools.has(name)) return result;
    const detail = { webhookId: typeof args.id === 'string' ? args.id : (result as { id?: string }).id ?? null };
    return auditedReceipt(viewer, name, detail, result as Record<string, unknown>);
  },
}];
