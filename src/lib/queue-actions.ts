import { prisma } from './prisma';
import { logActivity } from './scheduler/runner';

/**
 * Whole-queue actions: shuffle what is coming up, or take it all off the
 * calendar. Only posts this app will send at their time are touched — ones
 * Facebook is holding, ones going out right now, and ones waiting for review
 * keep their place.
 */

/** The upcoming posts an action may move, for one Page or the whole workspace. */
async function movable(workspaceId: string, targetIds: string[] | null, now: Date) {
  return prisma.post.findMany({
    where: {
      workspaceId,
      status: 'scheduled',
      publishMode: 'worker',
      scheduledAt: { gt: new Date(now.getTime() + 60_000) },
      // Nothing claimed or handed to Facebook on any destination.
      targets: { every: { status: 'pending' } },
      ...(targetIds ? { AND: [{ targets: { some: { targetId: { in: targetIds } } } }] } : {}),
    },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: 'asc' },
  });
}

/**
 * Keep the same times, deal the posts out among them in a new order: a week
 * that reads link, link, link becomes a mixed one, and nothing moves to a
 * time that was not already planned.
 */
export async function shuffleQueue(options: {
  workspaceId: string;
  userId: string;
  targetIds: string[] | null;
  now?: Date;
  random?: () => number;
}): Promise<number> {
  const posts = await movable(options.workspaceId, options.targetIds, options.now ?? new Date());
  if (posts.length < 2) return 0;
  const times = posts.map((post) => post.scheduledAt!);
  const order = [...posts];
  const random = options.random ?? Math.random;
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  await prisma.$transaction(order.map((post, index) => prisma.post.update({ where: { id: post.id }, data: { scheduledAt: times[index] } })));
  await logActivity(options.workspaceId, 'post.updated', { action: 'queue.shuffled', posts: posts.length }, options.userId);
  return posts.length;
}

/** Take every movable upcoming post off the calendar, back to drafts. Nothing is deleted. */
export async function clearQueue(options: {
  workspaceId: string;
  userId: string;
  targetIds: string[] | null;
  now?: Date;
}): Promise<number> {
  const posts = await movable(options.workspaceId, options.targetIds, options.now ?? new Date());
  if (posts.length === 0) return 0;
  await prisma.post.updateMany({
    where: { id: { in: posts.map((post) => post.id) } },
    data: { status: 'draft', scheduledAt: null },
  });
  await logActivity(options.workspaceId, 'post.updated', { action: 'queue.cleared', posts: posts.length }, options.userId);
  return posts.length;
}
