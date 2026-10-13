import { z } from 'zod';

import { ok, readJson, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { errors } from '@/lib/errors';
import { setInboxAssignee } from '@/lib/inbox';
import { targetScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  kind: z.enum(['comment', 'message']),
  id: z.string().min(1),
  /** A member of the team, or null to take it back. */
  assigneeId: z.string().min(1).nullable(),
});

/** Assign a comment or conversation to a teammate (or nobody), on a Page the caller may see. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse(await readJson(request));
  const pages = await prisma.target.findMany({
    where: { workspaceId: auth.workspace.id, ...targetScope(auth.pageScope) },
    select: { id: true },
  });
  const done = await setInboxAssignee({ workspaceId: auth.workspace.id, targetIds: pages.map((page) => page.id), ...input });
  if (!done) throw errors.notFound();
  return ok({ ok: true });
});
