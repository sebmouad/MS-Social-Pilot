import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { deleteUserAsRoot, setUserDisabled } from '@/lib/root';

const schema = z.object({ disabled: z.boolean() });

/** Disable or re-enable an account. Root only (404 for everyone else). */
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const { disabled } = schema.parse(await readJson(request));
  await setUserDisabled(auth.user.id, id, disabled);
  return ok({ ok: true });
});

/** Delete an account. Root only (404 for everyone else). */
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  await deleteUserAsRoot(auth.user.id, id);
  return ok({ ok: true });
});
