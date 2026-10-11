import { requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { signOutUser } from '@/lib/root';

/** End every session of an account. Root only (404 for everyone else). */
export const POST = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  return ok({ sessions: await signOutUser(auth.user.id, id) });
});
