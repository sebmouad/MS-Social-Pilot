import { endRootVisit, requireRootApi, setActiveWorkspaceCookie, startRootVisit } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { logVisit } from '@/lib/root';

/**
 * Root opens a workspace as its owner. Logged in root activity; a banner shows
 * on every screen until root leaves. Root only (404 for everyone else).
 */
export const POST = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const { member } = await logVisit(auth.user.id, id);
  if (member) {
    // Root's own workspace: an ordinary switch, no visit.
    await endRootVisit();
    await setActiveWorkspaceCookie(id);
  } else {
    await startRootVisit(id);
  }
  return ok({ ok: true });
});
