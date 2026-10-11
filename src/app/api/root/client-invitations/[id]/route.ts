import { requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { revokeClientInvitation } from '@/lib/root';

/** Revoke an invitation to create a workspace. Root only (404 for everyone else). */
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  await revokeClientInvitation(auth.user.id, id);
  return ok({ ok: true });
});
