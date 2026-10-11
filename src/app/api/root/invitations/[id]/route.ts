import { requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { revokeInvitation } from '@/lib/root';

/** Revoke any workspace's invitation. Root only (404 for everyone else). */
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  await revokeInvitation(auth.user.id, id);
  return ok({ ok: true });
});
