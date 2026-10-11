import { requireCapability } from '@/lib/auth';
import { testChatChannel } from '@/lib/chat';
import { canManageSettings } from '@/lib/constants';
import { ok, route } from '@/lib/api';

/** Send a test message now. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  return ok({ error: await testChatChannel(id, auth.workspace.id) });
});
