import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { ok, readJson, route, translate } from '@/lib/api';
import { BULK_LIMIT, bulkPostAction } from '@/lib/post-bulk';
import { logActivity } from '@/lib/scheduler/runner';

const schema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_LIMIT),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('cancel') }),
    z.object({ kind: z.literal('shift'), days: z.number().int().min(-365).max(365).refine((days) => days !== 0) }),
    z.object({ kind: z.literal('label'), labelId: z.string().min(1).max(64), add: z.boolean() }),
  ]),
});

/** One action on the posts selected in the list: cancel, move by days, label. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse(await readJson(request));

  const result = await bulkPostAction(
    {
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: auth.role,
      requiresApproval: auth.workspace.requiresApproval,
      pageScope: auth.pageScope,
    },
    input.ids,
    input.action,
  );

  await logActivity(
    auth.workspace.id,
    'post.bulkAction',
    { action: input.action.kind, done: result.done, failed: result.failed.length },
    auth.user.id,
  );

  return ok({
    done: result.done,
    failed: await Promise.all(
      result.failed.map(async (failure) => ({
        id: failure.id,
        message: failure.key ? await translate(failure.key, failure.params ?? {}, failure.message) : failure.message,
      })),
    ),
  });
});
