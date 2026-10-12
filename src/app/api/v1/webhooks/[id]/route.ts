import { ForbiddenError } from '@/lib/auth';
import { requireApiToken } from '@/lib/api-tokens';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/scheduler/runner';
import { ok, route } from '@/lib/api';
import { webhookNotFound } from '@/lib/webhooks';

/** Unsubscribe (what Zapier calls when a Zap is turned off). */
export const DELETE = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiToken(request, 'write');
  if (!canManageSettings(ctx.role)) throw new ForbiddenError('Only an owner or admin key can manage webhooks.');
  const { id } = await context.params;
  const { count } = await prisma.webhookEndpoint.deleteMany({ where: { id, workspaceId: ctx.workspace.id } });
  if (count === 0) throw webhookNotFound();
  await logActivity(ctx.workspace.id, 'webhook.deleted', { webhookId: id, viaApi: true }, ctx.user.id);
  return ok({ ok: true });
});
