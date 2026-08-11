import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { removeLinkedAccount, setLinkedAccountEnabled } from '@/lib/connections';
import { fail, ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

const schema = z.object({ enabled: z.boolean() });

/** Turn one ad account's syncing on or off. */
export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = schema.parse(await readJson(request));

  const result = await setLinkedAccountEnabled({
    workspaceId: auth.workspace.id,
    role: auth.role,
    kind: 'ads',
    id,
    enabled: input.enabled,
  });

  if (result.outcome === 'forbidden') return fail('You cannot change connections.', 403);
  if (result.outcome === 'not_found') return fail('Account not found.', 404);

  return ok({ enabled: input.enabled });
});

/** Forget an ad account and its stored spend rows. */
export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const result = await removeLinkedAccount({
    workspaceId: auth.workspace.id,
    role: auth.role,
    kind: 'ads',
    id,
  });

  if (result.outcome === 'forbidden') return fail('You cannot change connections.', 403);
  if (result.outcome === 'not_found') return fail('Account not found.', 404);

  return ok({ removed: true });
});
