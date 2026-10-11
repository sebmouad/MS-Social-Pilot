import { requireAuth } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { twoStepRequired } from '@/lib/two-step';

/** Remove one of your passkeys — not the last second step of an account that must have one. */
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await params;
  const passkey = await prisma.passkey.findUnique({ where: { id } });
  if (!passkey || passkey.userId !== auth.user.id) throw errors.notFound();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: { totpEnabledAt: true, _count: { select: { passkeys: true } } },
  });
  const lastFactor = !user.totpEnabledAt && user._count.passkeys <= 1;
  if (lastFactor && (await twoStepRequired(auth.user.id))) throw errors.twoStepRequired();

  await prisma.passkey.delete({ where: { id } });
  return ok({ ok: true });
});
