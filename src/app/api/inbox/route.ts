import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';
import { setInboxResolved } from '@/lib/inbox';
import { targetScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  kind: z.enum(['comment', 'message']),
  id: z.string().min(1),
  resolved: z.boolean(),
});

/** Mark a comment or a conversation done, or not done again, on a Page the member may see. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse(await readJson(request));
  const pages = await prisma.target.findMany({
    where: { workspaceId: auth.workspace.id, ...targetScope(auth.pageScope) },
    select: { id: true },
  });
  const done = await setInboxResolved({
    workspaceId: auth.workspace.id,
    targetIds: pages.map((page) => page.id),
    ...input,
  });
  if (!done) throw errors.notFound();
  return ok({ ok: true });
});
