import { z } from 'zod';

import { requireCapability } from '@/lib/auth';
import { canManageOthersPosts } from '@/lib/constants';
import { assertPageParam } from '@/lib/page-access';
import { clearDrafts, clearQueue, shuffleQueue } from '@/lib/queue-actions';
import { errors } from '@/lib/errors';
import { ok, readJson, route } from '@/lib/api';

const schema = z.object({
  action: z.enum(['shuffle', 'clear', 'clearDrafts']),
  /** One Page's queue, or every Page's when absent. */
  targetId: z.string().min(1).nullish(),
});

/**
 * Shuffle or clear what is coming up. Editors and above: both move other
 * people's posts.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageOthersPosts);
  const input = schema.parse(await readJson(request));
  assertPageParam(auth.pageScope, input.targetId);
  const targetIds = input.targetId ? [input.targetId] : auth.pageScope.all ? null : auth.pageScope.ids;
  const options = { workspaceId: auth.workspace.id, userId: auth.user.id, targetIds };
  if (input.action === 'clearDrafts') {
    // One Page at a time: clearing every draft in the workspace is not a click.
    if (!input.targetId) throw errors.notFound();
    return ok({ moved: await clearDrafts({ workspaceId: auth.workspace.id, userId: auth.user.id, targetId: input.targetId }) });
  }
  const moved = input.action === 'shuffle' ? await shuffleQueue(options) : await clearQueue(options);
  return ok({ moved });
});
