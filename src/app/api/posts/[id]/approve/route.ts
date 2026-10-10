import { z } from 'zod';
import { getTranslations } from 'next-intl/server';

import { requireAuth } from '@/lib/auth';
import { assertPostInScope } from '@/lib/page-access';
import { approvePost, rejectPost, submitForApproval, withdrawFromReview } from '@/lib/approvals';
import { ok, readJson, route } from '@/lib/api';
import { nativeFallbackKey } from '@/lib/posts';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit') }),
  z.object({ action: z.literal('withdraw') }),
  z.object({ action: z.literal('approve') }),
  z.object({
    action: z.literal('reject'),
    note: z.string().trim().min(1, 'Say why, so the author can fix it.').max(2000),
  }),
]);

/** Submit for review, withdraw from it, approve, or send back with a note. */
export const POST = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);
  const input = schema.parse(await readJson(request));

  // Set when approving had something to say beyond "done": a post meant for
  // Facebook to hold that our worker will publish instead.
  let notice: string | undefined;

  switch (input.action) {
    case 'submit':
      await submitForApproval({
        workspaceId: auth.workspace.id,
        postId: id,
        userId: auth.user.id,
        role: auth.role,
      });
      break;

    case 'withdraw':
      await withdrawFromReview({
        workspaceId: auth.workspace.id,
        postId: id,
        userId: auth.user.id,
        role: auth.role,
      });
      break;

    case 'approve': {
      const approved = await approvePost({
        workspaceId: auth.workspace.id,
        postId: id,
        reviewerId: auth.user.id,
        reviewerRole: auth.role,
      });
      if (approved.nativeFallback) {
        const t = await getTranslations('posts');
        notice = t(nativeFallbackKey(approved.nativeFallback));
      }
      break;
    }

    case 'reject':
      await rejectPost({
        workspaceId: auth.workspace.id,
        postId: id,
        reviewerId: auth.user.id,
        reviewerRole: auth.role,
        note: input.note,
      });
      break;
  }

  return ok({ ok: true, ...(notice ? { notice } : {}) });
});
