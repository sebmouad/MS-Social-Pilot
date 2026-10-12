import { requireAuth } from '@/lib/auth';
import { errors } from '@/lib/errors';
import { signOutSession } from '@/lib/sessions';
import { ok, route } from '@/lib/api';

/** Sign one of your own browsers out. Somebody else's session is a 404. */
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await params;
  if (!(await signOutSession(auth.user.id, id))) throw errors.notFound();
  return ok({ ok: true });
});
