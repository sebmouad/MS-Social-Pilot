import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/api';
import { replyToConversationAs, type ReplyOutcome } from '@/lib/engagement';

const replySchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
});

/**
 * Reply to somebody in a Page's inbox.
 *
 * Separate from the comment route because the failures are different: a
 * comment can always be answered, an inbox thread only within Facebook's
 * 24-hour window and only when the last word was not already the Page's. Each
 * of those gets its own sentence rather than a generic refusal.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = replySchema.parse(await readJson(request));

  const result = await replyToConversationAs({
    conversationId: input.conversationId,
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    role: auth.role,
    message: input.message,
  });

  return respond(result.outcome, { remoteId: result.remoteId });
});

function respond(outcome: ReplyOutcome, body: Record<string, unknown>) {
  switch (outcome) {
    case 'ok':
      return ok(body);
    case 'forbidden':
      return fail('You do not have permission to reply to messages.', 403);
    case 'not_found':
      return fail('Conversation not found.', 404);
    case 'no_recipient':
      return fail(
        'Nobody to reply to: the last message in this thread is the Page’s own.',
        409,
      );
    case 'outside_window':
      return fail(
        'Facebook only allows a reply within 24 hours of the last message from the person. This thread has gone quiet for longer, so a reply would be refused.',
        409,
      );
  }
}
