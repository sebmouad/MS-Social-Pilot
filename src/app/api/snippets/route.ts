import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

const snippetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(5000),
});

/** The workspace's saved texts, for the composer. */
export const GET = route(async () => {
  const auth = await requireAuth();
  const snippets = await prisma.snippet.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, body: true },
  });
  return ok({ snippets });
});

/** Save a text for reuse. Anyone who writes posts may: they are the ones retyping it. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = snippetSchema.parse(await readJson(request));
  const snippet = await prisma.snippet.create({
    data: { workspaceId: auth.workspace.id, ...input },
    select: { id: true, name: true, body: true },
  });
  return ok({ snippet }, 201);
});
