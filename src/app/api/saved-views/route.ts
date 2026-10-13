import { z } from 'zod';

import { ok, readJson, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const SAVED_VIEW_SCREENS = ['calendar', 'posts'] as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  screen: z.enum(SAVED_VIEW_SCREENS),
  /** The address's own query string; whatever the screen understands. */
  query: z.string().max(1500),
});

/** Saved views (competitor gap: Planable, Hootsuite): per person, per screen. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const screen = new URL(request.url).searchParams.get('screen');
  const views = await prisma.savedView.findMany({
    where: { workspaceId: auth.workspace.id, userId: auth.user.id, ...(screen ? { screen } : {}) },
    select: { id: true, name: true, screen: true, query: true },
    orderBy: { name: 'asc' },
  });
  return ok({ views });
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = createSchema.parse(await readJson(request));
  const view = await prisma.savedView.create({
    data: { workspaceId: auth.workspace.id, userId: auth.user.id, ...input, query: input.query.replace(/^\?/, '') },
    select: { id: true, name: true, screen: true, query: true },
  });
  return ok({ view }, 201);
});
