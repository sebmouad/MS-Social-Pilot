import { ApprovalStatus, PostStatus } from '@prisma/client';

import { prisma } from './prisma';
import { parseVariants, toJson, toJsonOrNull } from './json';
import { logActivity } from './scheduler/runner';

/**
 * Evergreen recycling.
 *
 * A post marked evergreen is republished on a cycle. Two decisions shape this:
 *
 * 1. **Each cycle creates a new post**, a copy of the original, rather than
 *    re-running the original row. Per-attempt history stays intact, each run is
 *    independently retryable, and the calendar shows what actually went out.
 *
 * 2. **Text variants are rotated.** Facebook rejects identical repeated content
 *    with error 506, so a post recycled with a single wording fails on its
 *    second outing. The UI warns about that; here we simply use whatever
 *    variants exist, falling back to the original text.
 */

/** Which wording this run should use. `runIndex` is 0 for the original post. */
export function variantForRun(original: string, variants: string[], runIndex: number): string {
  const pool = [original, ...variants].filter((text) => text.trim().length > 0);
  if (pool.length === 0) return original;
  return pool[runIndex % pool.length]!;
}

/** When the next repeat is due, or null when the post has finished its run. */
export function nextRecycleAt(options: {
  everyDays: number | null;
  limit: number | null;
  count: number;
  from: Date;
}): Date | null {
  if (!options.everyDays || options.everyDays < 1) return null;
  if (options.limit !== null && options.count >= options.limit) return null;

  return new Date(options.from.getTime() + options.everyDays * 24 * 60 * 60 * 1000);
}

export interface RecycleResult {
  checked: number;
  created: number;
  finished: number;
}

/**
 * Create the next copy of every evergreen post that is due.
 *
 * Run by the worker on its own interval. Copies are scheduled immediately —
 * `recycleNextAt` *is* the intended publish time — and picked up by the normal
 * publishing tick, so they inherit retries, approval gating and link handling
 * for free.
 */
export async function runEvergreenCycle(options: {
  now?: Date;
  limit?: number;
  logger?: (message: string, detail?: unknown) => void;
} = {}): Promise<RecycleResult> {
  const now = options.now ?? new Date();

  const due = await prisma.post.findMany({
    where: {
      recycleEnabled: true,
      recycleNextAt: { lte: now },
      // Only a post that actually went out is worth repeating.
      status: { in: [PostStatus.published, PostStatus.partially_failed] },
    },
    include: { targets: { select: { targetId: true } } },
    take: options.limit ?? 50,
  });

  let created = 0;
  let finished = 0;

  for (const post of due) {
    const count = post.recycleCount + 1;
    const variants = parseVariants(post.variants);

    // Stop rather than repeat: a post whose destinations have all been removed
    // has nowhere to go.
    if (post.targets.length === 0) {
      await prisma.post.update({
        where: { id: post.id },
        data: { recycleEnabled: false, recycleNextAt: null },
      });
      finished += 1;
      continue;
    }

    const copy = await prisma.post.create({
      data: {
        workspaceId: post.workspaceId,
        authorId: post.authorId,
        message: variantForRun(post.message, variants, count),
        link: post.link,
        linkPreview: toJsonOrNull(post.linkPreview),
        media: toJson(post.media),
        status: PostStatus.scheduled,
        // Already approved once as the original; repeating it is not a new
        // editorial decision.
        approvalStatus: ApprovalStatus.not_required,
        publishMode: post.publishMode,
        scheduledAt: post.recycleNextAt ?? now,
        timezone: post.timezone,
        originPostId: post.id,
        targets: { create: post.targets.map((target) => ({ targetId: target.targetId })) },
      },
    });

    const next = nextRecycleAt({
      everyDays: post.recycleEveryDays,
      limit: post.recycleLimit,
      count,
      from: post.recycleNextAt ?? now,
    });

    await prisma.post.update({
      where: { id: post.id },
      data: {
        recycleCount: count,
        recycleNextAt: next,
        recycleEnabled: next !== null,
      },
    });

    if (next === null) finished += 1;
    created += 1;

    options.logger?.(`Recycled post ${post.id} as ${copy.id} (run ${count}).`);
    await logActivity(post.workspaceId, 'post.recycled', { postId: post.id, copyId: copy.id, run: count });
  }

  return { checked: due.length, created, finished };
}

/** Turn recycling on or off for a post. */
export async function setRecycling(options: {
  workspaceId: string;
  postId: string;
  enabled: boolean;
  everyDays?: number | null;
  limit?: number | null;
  variants?: string[];
}): Promise<void> {
  const post = await prisma.post.findFirst({
    where: { id: options.postId, workspaceId: options.workspaceId },
  });
  if (!post) return;

  const everyDays = options.everyDays ?? post.recycleEveryDays ?? 30;

  await prisma.post.update({
    where: { id: options.postId },
    data: {
      recycleEnabled: options.enabled,
      recycleEveryDays: everyDays,
      recycleLimit: options.limit ?? post.recycleLimit,
      ...(options.variants ? { variants: toJson(options.variants) } : {}),
      recycleNextAt: options.enabled
        ? nextRecycleAt({
            everyDays,
            limit: options.limit ?? post.recycleLimit,
            count: post.recycleCount,
            // Measured from publication, so the first repeat is a full
            // interval after the post actually went out.
            from: post.publishedAt ?? new Date(),
          })
        : null,
    },
  });
}
