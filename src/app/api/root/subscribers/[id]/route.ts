import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { logRootActivity } from '@/lib/root';

const schema = z.object({ planId: z.string().min(1).nullable().optional(), extraChannels: z.number().int().min(0).max(100_000).optional() });

/** Root puts a subscriber on a plan, or gives them extra channels. */
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const input = schema.parse(await readJson(request));
  const user = await prisma.user.update({ where: { id }, data: input, select: { email: true, plan: { select: { name: true } }, extraChannels: true } });
  await logRootActivity(auth.user.id, 'subscriber.planChanged', { email: user.email, plan: user.plan?.name ?? '—', extra: user.extraChannels });
  return ok({ ok: true });
});
