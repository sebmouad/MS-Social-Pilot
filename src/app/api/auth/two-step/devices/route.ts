import { requireAuth } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { prisma } from '@/lib/prisma';

/** Forget every remembered device: the next sign-in anywhere asks for the second step. */
export const DELETE = route(async () => {
  const auth = await requireAuth();
  const { count } = await prisma.trustedDevice.deleteMany({ where: { userId: auth.user.id } });
  return ok({ forgotten: count });
});
