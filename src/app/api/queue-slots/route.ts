import { requireAuth } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { queueSlotsSchema } from '@/lib/validation';
import { assertPageParam } from '@/lib/page-access';
import { ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/**
 * The queue's times. `?for=<Page id>` adds that Page's own times to the shared
 * ones; each slot says whose it is (`targetId`, null when every Page shares it).
 */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const page = new URL(request.url).searchParams.get('for');
  if (page) assertPageParam(auth.pageScope, page);
  const slots = await prisma.queueSlot.findMany({
    where: { workspaceId: auth.workspace.id, OR: [{ targetId: null }, ...(page ? [{ targetId: page }] : [])] },
    orderBy: [{ dayOfWeek: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
  });
  return ok({ slots });
});

/**
 * Replace one timetable in one call: the shared one, or one Page's own.
 *
 * The same permission the rest of the workspace's settings need, and for the
 * same reason: these slots decide when everything in the queue goes out, for
 * everybody. A contributor is somebody whose own posts are reviewed before
 * they publish — rewriting the client's schedule is not a smaller act than
 * that, it is a larger one.
 *
 * Reading stays open to any member: the composer has to know whether there is
 * a queue to add to.
 */
export const PUT = route(async (request: Request) => {
  const auth = await requireAuth();
  if (!canManageSettings(auth.role)) {
    throw errors.adminsOnlySchedule();
  }

  const { slots, targetId = null } = queueSlotsSchema.parse(await readJson(request));
  if (targetId) {
    const page = await prisma.target.findFirst({
      where: { id: targetId, workspaceId: auth.workspace.id },
      select: { id: true },
    });
    if (!page) throw errors.destinationNotFound();
  }

  // Deduplicate: the unique constraint would otherwise reject the whole write
  // because a user clicked "add" twice on the same time.
  const unique = new Map(slots.map((slot) => [`${slot.dayOfWeek}-${slot.hour}-${slot.minute}`, slot]));

  await prisma.$transaction([
    prisma.queueSlot.deleteMany({ where: { workspaceId: auth.workspace.id, targetId } }),
    prisma.queueSlot.createMany({
      data: [...unique.values()].map((slot) => ({ ...slot, workspaceId: auth.workspace.id, targetId })),
    }),
  ]);

  return ok({ count: unique.size });
});
