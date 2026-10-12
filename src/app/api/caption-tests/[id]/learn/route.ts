import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { saveLearning } from '@/lib/caption-test';
import { logActivity } from '@/lib/scheduler/runner';
import { ok, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

/**
 * Add a finished test's winning caption to the voice of the Pages it ran on.
 * The same right as editing a Page's voice (admin+).
 */
export const POST = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const outcome = await saveLearning({ id, workspaceId: auth.workspace.id });
  if (outcome === 'not_found' || outcome === 'not_decided') throw errors.notFound();
  if (outcome === 'ok') await logActivity(auth.workspace.id, 'captionTest.learned', { testId: id }, auth.user.id);
  return ok({ saved: true });
});
