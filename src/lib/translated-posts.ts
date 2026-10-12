import type { WorkspaceRole } from '@prisma/client';

import { createPost, type CreatePostResult } from './posts';
import type { CreatePostInput } from './validation';

/**
 * A post translated for its Pages' audiences (NEXT_PHASES G11): one post per
 * translation, each to its own Pages, and one more for the Pages left in the
 * original. Same time, media, link and options for all.
 */
export async function createTranslated(
  context: { workspaceId: string; userId: string; role: WorkspaceRole; requiresApproval: boolean },
  input: CreatePostInput,
  now: Date = new Date(),
): Promise<CreatePostResult & { posts: number }> {
  const translated = new Set(input.translations!.flatMap((translation) => translation.targetIds));
  const rest = input.targetIds.filter((id) => !translated.has(id));
  const parts = [
    ...(rest.length > 0 ? [{ targetIds: rest, message: input.message }] : []),
    ...input.translations!,
  ];

  const created: CreatePostResult[] = [];
  for (const part of parts) {
    created.push(await createPost(context, { ...input, ...part, translations: undefined }, now));
  }
  return { ...created[0]!, results: created.flatMap((result) => result.results), posts: created.length };
}
