import { voiceWithAvoid } from './brand';
import type { Locale, WorkspaceRole } from '@prisma/client';

import { aiAvailable, improveCaption } from './ai';
import { createPost, type CreatePostResult } from './posts';
import { prisma } from './prisma';
import { shiftLocalInput } from './spam-guard';
import { utcToLocalInput } from './time';
import type { CreatePostInput } from './validation';

/**
 * The fix the spam-risk guard offers: the same post becomes
 * one post per Page, `staggerMinutes` apart, starting at the time picked (or
 * now). With `aiVariants`, every Page after the first gets the caption reworded
 * in its own voice, so no two Pages carry identical text either.
 *
 * Applies only to a dated or immediate post for two or more Pages; anything
 * else (a draft, the queue) is created as usual.
 */
export async function createStaggered(
  context: { workspaceId: string; userId: string; role: WorkspaceRole; requiresApproval: boolean; locale: Locale; undoSendSeconds?: number },
  input: CreatePostInput,
  now: Date = new Date(),
): Promise<CreatePostResult & { posts: number }> {
  const stagger = input.staggerMinutes ?? 0;
  const applies =
    stagger > 0 && input.targetIds.length > 1 && !input.saveAsDraft && !input.useQueue &&
    (input.publishMode === 'immediate' || Boolean(input.scheduledAtLocal));
  const { locale: _locale, ...postContext } = context;
  if (!applies) return { ...(await createPost(postContext, input, now)), posts: 1 };
  // One Undo cannot take back the Pages that follow, so a staggered post is not held.
  delete postContext.undoSendSeconds;

  const start = input.scheduledAtLocal ?? utcToLocalInput(now, input.timezone);
  const voices = input.aiVariants && aiAvailable() ? await pageVoices(context.workspaceId, input.targetIds) : null;

  const created: CreatePostResult[] = [];
  for (const [index, targetId] of input.targetIds.entries()) {
    const first = index === 0;
    const message = first || !voices ? input.message : await reword(context, input.message, voices.get(targetId));
    created.push(
      await createPost(
        postContext,
        {
          ...input,
          message,
          targetIds: [targetId],
          // Only the first Page goes out on the spot; the others wait their turn.
          publishMode: first || input.publishMode !== 'immediate' ? input.publishMode : 'worker',
          scheduledAtLocal:
            first && input.publishMode === 'immediate' ? input.scheduledAtLocal : shiftLocalInput(start, index * stagger),
        },
        now,
      ),
    );
  }

  return {
    ...created[0]!,
    results: created.flatMap((result) => result.results),
    posts: created.length,
  };
}

async function pageVoices(workspaceId: string, targetIds: string[]) {
  const [workspace, pages] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiEnabled: true, aiTone: true, aiBrandVoice: true, aiAvoidWords: true } }),
    prisma.target.findMany({ where: { workspaceId, id: { in: targetIds } }, select: { id: true, brandVoice: true } }),
  ]);
  if (!workspace?.aiEnabled) return null;
  return new Map(
    pages.map((page) => [page.id, { tone: workspace.aiTone, brandVoice: voiceWithAvoid(page.brandVoice?.trim() || workspace.aiBrandVoice, workspace.aiAvoidWords) }]),
  );
}

/** The caption reworded for one Page; the original when the AI has nothing to give. */
async function reword(
  context: { workspaceId: string; userId: string; locale: Locale },
  message: string,
  voice: { tone: string | null; brandVoice: string | null } | undefined,
): Promise<string> {
  if (message.trim().length < 3) return message;
  try {
    const result = await improveCaption({
      workspaceId: context.workspaceId,
      userId: context.userId,
      draft: message,
      tone: voice?.tone ?? null,
      brandVoice: voice?.brandVoice ?? null,
      locale: context.locale,
    });
    return result.text.trim() || message;
  } catch (error) {
    // A variant is a nicety; the Page still gets its post, in the original words.
    console.error('[stagger] could not reword caption', error);
    return message;
  }
}
