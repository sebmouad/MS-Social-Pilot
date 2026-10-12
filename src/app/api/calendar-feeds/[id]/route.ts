import { requireAuth } from '@/lib/auth';
import { revokeFeed } from '@/lib/calendar-feeds';
import { ok, route } from '@/lib/api';

/** Revoke one of my calendar feeds (H19): its address stops working. */
export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await revokeFeed(auth.workspace.id, auth.user.id, id);
  return ok({ revoked: true });
});
