import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { createWorkspaceAsRoot } from '@/lib/root';

const schema = z.object({ name: z.string().trim().min(1).max(100), ownerEmail: z.string().trim().email() });

/** Create a workspace for an existing account. Root only (404 for everyone else). */
export const POST = route(async (request: Request) => {
  const auth = await requireRootApi();
  const { name, ownerEmail } = schema.parse(await readJson(request));
  return ok(await createWorkspaceAsRoot(auth.user.id, name, ownerEmail));
});
