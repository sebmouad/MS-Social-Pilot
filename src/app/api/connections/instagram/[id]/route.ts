import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { fail, ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

const schema = z.object({ enabled: z.boolean() });

/** Turn one Instagram account's syncing on or off. */
export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  if (!canManageAccounts(auth.role)) return fail('You cannot change connections.', 403);

  const { id } = await context.params;
  const input = schema.parse(await readJson(request));

  // Scoped by workspace, so an id from another tenant matches nothing.
  const updated = await prisma.instagramAccount.updateMany({
    where: { id, workspaceId: auth.workspace.id },
    data: { enabled: input.enabled },
  });

  return updated.count > 0 ? ok({ enabled: input.enabled }) : fail('Account not found.', 404);
});

/** Forget an Instagram account and everything captured for it. */
export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  if (!canManageAccounts(auth.role)) return fail('You cannot change connections.', 403);

  const { id } = await context.params;
  const removed = await prisma.instagramAccount.deleteMany({
    where: { id, workspaceId: auth.workspace.id },
  });

  return removed.count > 0 ? ok({ removed: true }) : fail('Account not found.', 404);
});
