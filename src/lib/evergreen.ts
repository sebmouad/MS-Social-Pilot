import { ApprovalStatus, PostStatus, WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { mediaColumns, parseMedia, parseVariants, toJson, toJsonOrNull } from './json';
import { logActivity } from './scheduler/runner';
import { canManageOthersPosts, canPublishWithoutApproval } from './constants';
import { errors } from './errors';

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
    include: {
      targets: { select: { targetId: true, target: { select: { enabled: true } } } },
    },
    take: options.limit ?? 50,
  });

  let created = 0;
  let finished = 0;

  for (const post of due) {
    const count = post.recycleCount + 1;
    const variants = parseVariants(post.variants);

    // Stop rather than repeat: a post whose destinations have all been removed
    // has nowhere to go. A destination that is merely turned off counts as gone
    // for this purpose — the copy would be created, skipped on the next tick
    // for pointing at a Page nobody turned back on, and replaced by another
    // copy an interval later, for ever. One dead repeat is a mistake; an
    // unbounded series of them is a mess someone has to clean up by hand.
    const live = post.targets.filter((row) => row.target.enabled);
    if (live.length === 0) {
      await prisma.post.update({
        where: { id: post.id },
        data: { recycleEnabled: false, recycleNextAt: null },
      });
      finished += 1;
      options.logger?.(
        `Stopped recycling post ${post.id}: none of its destinations are still active.`,
      );
      await logActivity(post.workspaceId, 'post.recycleStopped', {
        postId: post.id,
        reason: 'no active destinations',
      });
      continue;
    }

    const copy = await prisma.post.create({
      data: {
        workspaceId: post.workspaceId,
        authorId: post.authorId,
        message: variantForRun(post.message, variants, count),
        link: post.link,
        linkPreview: toJsonOrNull(post.linkPreview),
        ...mediaColumns(parseMedia(post.media)),
        status: PostStatus.scheduled,
        // Already approved once as the original; repeating it is not a new
        // editorial decision.
        approvalStatus: ApprovalStatus.not_required,
        publishMode: post.publishMode,
        scheduledAt: post.recycleNextAt ?? now,
        timezone: post.timezone,
        originPostId: post.id,
        targets: { create: live.map((row) => ({ targetId: row.targetId })) },
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

/**
 * Turn recycling on or off for a post, and set its alternate wordings.
 *
 * Variants are the part that needs guarding. Every recycled copy is created
 * `not_required` — repeating a post that was already approved is not a new
 * editorial decision — but a variant is not a repeat, it is different text that
 * nobody has read. Without a check, a contributor in a workspace with review on
 * could get one post approved and then attach any wording they liked to it and
 * have it published on a timer, which defeats the whole workflow more thoroughly
 * than editing the post ever could.
 *
 * So supplying variants requires the same standing as publishing without review.
 * Recycling the approved message itself stays open to everyone — that text has
 * been read. (Facebook rejects identical repeats with error 506, so in practice
 * a contributor who wants a recycled series needs an editor to word it, which is
 * the correct outcome rather than a workaround.)
 */
export async function setRecycling(options: {
  workspaceId: string;
  postId: string;
  userId: string;
  role: WorkspaceRole;
  requiresApproval: boolean;
  enabled: boolean;
  everyDays?: number | null;
  limit?: number | null;
  variants?: string[];
}): Promise<void> {
  const post = await prisma.post.findFirst({
    where: { id: options.postId, workspaceId: options.workspaceId },
  });
  // Was a silent success, which told the caller their schedule had been saved
  // when nothing had been written.
  if (!post) throw errors.postNotFound();
  if (post.authorId !== options.userId && !canManageOthersPosts(options.role)) {
    throw errors.noPermission();
  }

  const addsVariants = (options.variants?.filter((variant) => variant.trim().length > 0).length ?? 0) > 0;
  if (addsVariants && options.requiresApproval && !canPublishWithoutApproval(options.role)) {
    throw errors.variantsNeedApproval();
  }

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
            // Measured from publication, so the first repeat is a full interval
            // after the post actually goes out. Recycling is usually switched on
            // while composing, before there is a `publishedAt` at all, and
            // falling straight back to "now" measured the interval from the
            // click instead: a post scheduled a month out with a monthly repeat
            // came due for its first repeat the moment it published. The
            // scheduled time is what the post will go out at, so it is the
            // honest starting point until publication supplies the real one.
            from: post.publishedAt ?? post.scheduledAt ?? new Date(),
          })
        : null,
    },
  });
}
