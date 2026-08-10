import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/api';
import { moderateComment, readComments, removeComment, replyToCommentAs } from '@/lib/engagement';

/** The workspace comment stream, optionally filtered. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);

  const hidden = url.searchParams.get('hidden');

  return ok({
    comments: await readComments({
      workspaceId: auth.workspace.id,
      targetId: url.searchParams.get('targetId') ?? undefined,
      search: url.searchParams.get('q') ?? undefined,
      hidden: hidden === null ? undefined : hidden === 'true',
      limit: Number(url.searchParams.get('limit')) || undefined,
    }),
  });
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('hide'), commentId: z.string().min(1) }),
  z.object({ action: z.literal('unhide'), commentId: z.string().min(1) }),
  z.object({ action: z.literal('delete'), commentId: z.string().min(1) }),
  z.object({
    action: z.literal('reply'),
    commentId: z.string().min(1),
    message: z.string().trim().min(1).max(8000),
  }),
]);

/**
 * Moderate a comment.
 *
 * Every branch goes through the service layer, which scopes the lookup by
 * workspace — a comment id from another tenant resolves to nothing rather than
 * to someone else's comment.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = actionSchema.parse(await readJson(request));

  if (input.action === 'reply') {
    const remoteId = await replyToCommentAs({
      commentId: input.commentId,
      workspaceId: auth.workspace.id,
      message: input.message,
    });
    return remoteId ? ok({ remoteId }) : fail('Comment not found.', 404);
  }

  if (input.action === 'delete') {
    const removed = await removeComment({
      commentId: input.commentId,
      workspaceId: auth.workspace.id,
    });
    return removed ? ok({ deleted: true }) : fail('Comment not found.', 404);
  }

  const updated = await moderateComment({
    commentId: input.commentId,
    workspaceId: auth.workspace.id,
    hidden: input.action === 'hide',
  });

  return updated ? ok({ hidden: input.action === 'hide' }) : fail('Comment not found.', 404);
});
