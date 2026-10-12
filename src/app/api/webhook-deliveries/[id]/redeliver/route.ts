import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { ok, route } from '@/lib/api';
import { redeliverWebhook } from '@/lib/webhooks';

/** Send one past delivery again, now. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  return ok(await redeliverWebhook(id, auth.workspace.id));
});
