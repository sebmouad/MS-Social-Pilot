import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { queueSlotsSchema } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';

export const GET = route(async () => {
  const auth = await requireAuth();
  const slots = await prisma.queueSlot.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: [{ dayOfWeek: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
  });
  return ok({ slots });
});

/** Replace the whole publishing schedule in one call. */
export const PUT = route(async (request: Request) => {
  const auth = await requireAuth();
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
