import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/api';
import {
  moderateComment,
  readComments,
  removeComment,
  replyToCommentAs,
  type ModerationOutcome,
} from '@/lib/engagement';

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
      // Clamped here because this is where a number from a stranger arrives.
      // Internal callers ask for what they need — the CSV export wants
      // thousands — but a screen cannot use more than this, and an unbounded
      // one is a join across every comment in the workspace for the asking.
      limit: Math.min(Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 200),
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

  /** One mapping for all four actions, so no branch can forget a case. */
  const respond = (outcome: ModerationOutcome, body: Record<string, unknown>) => {
    if (outcome === 'forbidden') {
      return fail(
        input.action === 'delete'
          ? 'Only workspace owners and admins can delete comments on Facebook.'
          : 'You do not have permission to moderate comments.',
        403,
      );
    }
    if (outcome === 'not_found') return fail('Comment not found.', 404);
    return ok(body);
  };

  if (input.action === 'reply') {
    const result = await replyToCommentAs({
      commentId: input.commentId,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: auth.role,
      message: input.message,
    });
    return respond(result.outcome, { remoteId: result.remoteId });
  }

  if (input.action === 'delete') {
    return respond(
      await removeComment({
        commentId: input.commentId,
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        role: auth.role,
      }),
      { deleted: true },
    );
  }

  return respond(
    await moderateComment({
      commentId: input.commentId,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: auth.role,
      hidden: input.action === 'hide',
    }),
    { hidden: input.action === 'hide' },
  );
});
