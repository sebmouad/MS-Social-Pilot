import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { renameWorkspace } from '@/lib/root';

const schema = z.object({ name: z.string().trim().min(1).max(100) });

/** Rename a workspace. Root only (404 for everyone else). */
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const { name } = schema.parse(await readJson(request));
  await renameWorkspace(auth.user.id, id, name);
  return ok({ ok: true });
});
