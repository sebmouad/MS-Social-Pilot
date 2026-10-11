import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { cleanPinned } from '@/lib/pinned-metrics';

const schema = z.object({ metrics: z.array(z.string().max(120)).max(50) });

/** Replace your pinned metrics. Unknown, retired or non-daily names are dropped. */
export const PUT = route(async (request: Request) => {
  const auth = await requireAuth();
  const { metrics } = schema.parse(await readJson(request));
  const pinned = cleanPinned(metrics);
  await prisma.user.update({ where: { id: auth.user.id }, data: { pinnedMetrics: pinned } });
  return ok({ pinned });
});
