import { ok, route } from '@/lib/api';
import { ForbiddenError, requireAuth } from '@/lib/auth';
import { logActivity } from '@/lib/scheduler/runner';
import { requestExport } from '@/lib/workspace-export';

/**
 * Ask for a ZIP of everything the workspace holds (NEXT_PHASES G17). The
 * workspace owner only: it contains every Page's posts, comments and media.
 */
export const POST = route(async () => {
  const auth = await requireAuth();
  if (auth.role !== 'owner') throw new ForbiddenError('Only the workspace owner can export everything.');
  const entry = await requestExport(auth.workspace.id, auth.user.id);
  await logActivity(auth.workspace.id, 'workspace.exported', { exportId: entry.id }, auth.user.id);
  return ok({ id: entry.id, status: entry.status }, 202);
});
