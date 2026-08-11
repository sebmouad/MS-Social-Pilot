import { requireAuth } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { queueSlotsSchema } from '@/lib/validation';
import { fail, ok, readJson, route } from '@/lib/api';

export const GET = route(async () => {
  const auth = await requireAuth();
  const slots = await prisma.queueSlot.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: [{ dayOfWeek: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
  });
  return ok({ slots });
});

/**
 * Replace the whole publishing schedule in one call.
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
    return fail('Only workspace owners and admins can change the publishing schedule.', 403);
  }

  const { slots } = queueSlotsSchema.parse(await readJson(request));

  // Deduplicate: the unique constraint would otherwise reject the whole write
  // because a user clicked "add" twice on the same time.
  const unique = new Map(slots.map((slot) => [`${slot.dayOfWeek}-${slot.hour}-${slot.minute}`, slot]));

  await prisma.$transaction([
    prisma.queueSlot.deleteMany({ where: { workspaceId: auth.workspace.id } }),
    prisma.queueSlot.createMany({
      data: [...unique.values()].map((slot) => ({ ...slot, workspaceId: auth.workspace.id })),
    }),
  ]);

  return ok({ count: unique.size });
});
