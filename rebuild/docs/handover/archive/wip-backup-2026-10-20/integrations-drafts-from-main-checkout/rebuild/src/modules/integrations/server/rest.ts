import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { REST_HOOK_SCHEMA, ID_CONFIRM_SCHEMA, WEBHOOK_EVENTS } from '../contracts';
import { audit, notFound, parse, runtime, transact } from './core';
import { createWebhook, displayUrl, type WebhookView } from './webhooks';
import type { WebhookDeps } from './webhook-transport';
import type { ApiKeyContext } from './tokens';

/** REST v1 surface owned here: who the key is, and REST-hook (Zapier style) subscriptions the key itself made. */
export async function restMe(ctx: ApiKeyContext) {
  const rt = await runtime();
  return { workspace: { id: ctx.actor.workspaceId, name: ctx.workspaceName }, role: ctx.role, scope: ctx.scope, channels: ctx.actor.allowedTargetIds ? [...ctx.actor.allowedTargetIds] : 'all', events: [...WEBHOOK_EVENTS], maxPageSize: rt.limits.apiV1MaxPageSize };
}

export async function restListHooks(ctx: ApiKeyContext) {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; url: string; events: string[]; enabled: boolean; lastError: string | null; lastSentAt: Date | null; createdAt: Date }>>`SELECT id, name, url, events, enabled, "lastError", "lastSentAt", "createdAt" FROM webhook_endpoints WHERE "workspaceId" = ${ctx.actor.workspaceId} AND "apiTokenId" = ${ctx.tokenId} ORDER BY "createdAt" DESC, id DESC`;
  return { hooks: rows.map(row => ({ id: row.id, name: row.name, url: displayUrl(row.url), events: row.events as WebhookView['events'], enabled: row.enabled, lastError: row.lastError, lastSentAt: row.lastSentAt, createdAt: row.createdAt })) };
}

/** The key's owner must still be an owner/admin of the workspace (same authority as the dashboard); the secret is returned once. */
export async function restSubscribe(ctx: ApiKeyContext, input: unknown, deps?: Pick<WebhookDeps, 'resolve'>) {
  if (ctx.scope !== 'write') throw new OperationError('forbidden', 'This API key can only read.');
  const data = parse(REST_HOOK_SCHEMA, input, 'Send a public https url and at least one event.');
  return createWebhook({ userId: ctx.actor.userId, workspaceId: ctx.actor.workspaceId }, { name: data.name ?? 'REST hook', url: data.url, events: data.events }, { apiTokenId: ctx.tokenId, skipConfirmation: true, ...(deps ? { deps } : {}) });
}

/** A key may remove only the subscriptions it made itself. */
export async function restUnsubscribe(ctx: ApiKeyContext, input: unknown) {
  if (ctx.scope !== 'write') throw new OperationError('forbidden', 'This API key can only read.');
  const data = parse(ID_CONFIRM_SCHEMA.pick({ id: true }), input);
  const rt = await runtime();
  const actor = { userId: ctx.actor.userId, workspaceId: ctx.actor.workspaceId };
  return transact(actor, 'developer', rt.limits, async tx => {
    const removed = await tx.$queryRaw<Array<{ id: string }>>`DELETE FROM webhook_endpoints WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} AND "apiTokenId" = ${ctx.tokenId} RETURNING id`;
    if (!removed[0]) throw notFound('webhook');
    await audit(tx, actor, 'webhook.deleted', { webhookId: data.id, viaApiKey: ctx.tokenId });
    return { id: data.id, deleted: true as const };
  }, 'webhooks');
}
