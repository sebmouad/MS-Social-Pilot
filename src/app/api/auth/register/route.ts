import { prisma } from '@/lib/prisma';
import { registerUser, setSessionCookie } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { DEFAULT_QUEUE_SLOTS } from '@/lib/time';
import { ok, readJson, route } from '@/lib/api';

export const POST = route(async (request: Request) => {
  const input = registerSchema.parse(await readJson(request));
  const { userId, token } = await registerUser(input);

  // Seed a default posting queue so "add to queue" works immediately rather
  // than erroring on a brand-new workspace.
  const membership = await prisma.membership.findFirstOrThrow({ where: { userId } });
  await prisma.queueSlot.createMany({
    data: DEFAULT_QUEUE_SLOTS.map((slot) => ({ ...slot, workspaceId: membership.workspaceId })),
  });

  await setSessionCookie(token);
  return ok({ userId }, 201);
});
