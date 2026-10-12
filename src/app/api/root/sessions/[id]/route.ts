import { requireRootApi } from '@/lib/auth';
import { errors } from '@/lib/errors';
import { logRootActivity } from '@/lib/root';
import { rootSignOutSession } from '@/lib/sessions';
import { ok, route } from '@/lib/api';

/** Root signs any one browser out. Root only (404 for everyone else). */
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const signedOut = await rootSignOutSession(id);
  if (!signedOut) throw errors.notFound();
  await logRootActivity(auth.user.id, 'session.signedOut', { email: signedOut.email });
  return ok({ ok: true });
});
