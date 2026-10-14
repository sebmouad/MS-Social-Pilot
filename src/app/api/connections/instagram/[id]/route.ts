import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { removeLinkedAccount, setLinkedAccountEnabled } from '@/lib/connections';
import { ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';

type Context = { params: Promise<{ id: string }> };

const schema = z.object({ enabled: z.boolean() });

/** Turn one Instagram account's syncing on or off. */
export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = schema.parse(await readJson(request));

  const result = await setLinkedAccountEnabled({
    workspaceId: auth.workspace.id,
    role: auth.role,
    kind: 'instagram',
    id,
    enabled: input.enabled,
  });

  if (result.outcome === 'forbidden') throw errors.cannotChangeConnections();
  if (result.outcome === 'not_found') throw errors.accountNotFound();
  if (result.outcome === 'blocked') throw errors.destinationBlocked();

  return ok({ enabled: input.enabled });
});

/** Forget an Instagram account and everything captured for it. */
export const DELETE = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = z.object({ deleteData: z.boolean().default(true) }).parse((await readJson(request).catch(() => ({}))) ?? {});

  const result = await removeLinkedAccount({
    workspaceId: auth.workspace.id,
    role: auth.role,
    kind: 'instagram',
    id,
    deleteData: input.deleteData,
  });

  if (result.outcome === 'forbidden') throw errors.cannotChangeConnections();
  if (result.outcome === 'not_found') throw errors.accountNotFound();

  return ok({ removed: true });
});
