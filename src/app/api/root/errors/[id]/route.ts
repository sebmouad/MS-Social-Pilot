import { requireRootApi } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { prisma } from '@/lib/prisma';

/** Root marks an error resolved; its next occurrence opens it again. */
export const POST = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireRootApi();
  const { id } = await params;
  await prisma.errorEvent.updateMany({ where: { id }, data: { resolvedAt: new Date() } });
  return ok({ ok: true });
});
