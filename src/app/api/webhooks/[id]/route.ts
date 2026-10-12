import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/scheduler/runner';
import { ok, readJson, route } from '@/lib/api';
import { webhookNotFound, webhookUpdateSchema } from '@/lib/webhooks';

type Context = { params: Promise<{ id: string }> };

/** The last 50 deliveries, newest first, for the log. */
export const GET = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, workspaceId: auth.workspace.id }, select: { id: true } });
  if (!endpoint) throw webhookNotFound();
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, event: true, status: true, attempts: true, responseStatus: true, error: true, createdAt: true, deliveredAt: true, nextAttemptAt: true },
  });
  return ok({ deliveries });
});

/** Switch on or off, or change the events. */
export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const input = webhookUpdateSchema.parse(await readJson(request));
  const { count } = await prisma.webhookEndpoint.updateMany({ where: { id, workspaceId: auth.workspace.id }, data: input });
  if (count === 0) throw webhookNotFound();
  return ok({ ok: true });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const { count } = await prisma.webhookEndpoint.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  if (count === 0) throw webhookNotFound();
  await logActivity(auth.workspace.id, 'webhook.deleted', { webhookId: id }, auth.user.id);
  return ok({ ok: true });
});
