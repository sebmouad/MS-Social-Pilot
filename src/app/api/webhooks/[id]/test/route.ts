import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { ok, route } from '@/lib/api';
import { testWebhook } from '@/lib/webhooks';

/** Send a `ping` now and say what the receiver answered. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  return ok(await testWebhook(id, auth.workspace.id));
});
