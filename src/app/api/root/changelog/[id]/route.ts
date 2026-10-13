import { requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { logRootActivity } from '@/lib/root';
import { deleteChangelogEntry } from '@/lib/site';

/** Root removes a changelog entry. */
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const removed = await deleteChangelogEntry(id);
  if (removed) await logRootActivity(auth.user.id, 'changelog.removed', { id });
  return ok({ removed });
});
