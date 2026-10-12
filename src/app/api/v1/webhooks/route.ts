import { ForbiddenError } from '@/lib/auth';
import { requireApiToken } from '@/lib/api-tokens';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/scheduler/runner';
import { ok, readJson, route } from '@/lib/api';
import { createWebhook, webhookSchema } from '@/lib/webhooks';

/**
 * REST hooks for Zapier, n8n and Make: subscribe with a `write` key belonging
 * to an owner or admin, unsubscribe with DELETE on the returned id.
 */
async function adminKey(request: Request, need: 'read' | 'write') {
  const ctx = await requireApiToken(request, need);
  if (!canManageSettings(ctx.role)) throw new ForbiddenError('Only an owner or admin key can manage webhooks.');
  return ctx;
}

export const GET = route(async (request: Request) => {
  const ctx = await adminKey(request, 'read');
  const webhooks = await prisma.webhookEndpoint.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, url: true, events: true, enabled: true },
  });
  return ok({ webhooks });
});

export const POST = route(async (request: Request) => {
  const ctx = await adminKey(request, 'write');
  const input = webhookSchema.parse(await readJson(request));
  const created = await createWebhook(ctx.workspace.id, input, ctx.tokenId);
  await logActivity(ctx.workspace.id, 'webhook.created', { webhookId: created.id, name: input.name, viaApi: true }, ctx.user.id);
  return ok(created, 201);
});
