import { requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { resetTwoStepFor } from '@/lib/root';

/** Lost phone: clear someone's second step; they set it up again at their next sign-in. Root only. */
export const POST = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  await resetTwoStepFor(auth.user.id, id);
  return ok({ ok: true });
});
