import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/scheduler/runner';
import { ok, readJson, route } from '@/lib/api';
import { createWebhook, webhookSchema } from '@/lib/webhooks';

/** The workspace's webhooks (without secrets) and their last deliveries. */
export const GET = route(async () => {
  const auth = await requireCapability(canManageSettings);
  const webhooks = await prisma.webhookEndpoint.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, url: true, events: true, enabled: true, lastError: true, lastSentAt: true, apiTokenId: true },
  });
  return ok({ webhooks });
});

/** Add one. The signing secret is in this answer and nowhere else, ever. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const input = webhookSchema.parse(await readJson(request));
  const created = await createWebhook(auth.workspace.id, input);
  await logActivity(auth.workspace.id, 'webhook.created', { webhookId: created.id, name: input.name }, auth.user.id);
  return ok(created, 201);
});
