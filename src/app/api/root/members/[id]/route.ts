import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { MODULE_KEYS, type ModuleKey } from '@/lib/modules';
import { changeMemberRole, removeMemberAsRoot, setMemberModules } from '@/lib/root';

const schema = z.object({
  role: z.nativeEnum(WorkspaceRole).optional(),
  disabledModules: z.array(z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]])).optional(),
});

/** Change a member's role or switch modules off for them. Root only (404 for everyone else). */
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const body = schema.parse(await readJson(request));
  if (body.role !== undefined) await changeMemberRole(auth.user.id, id, body.role);
  if (body.disabledModules !== undefined) await setMemberModules(auth.user.id, id, body.disabledModules);
  return ok({ ok: true });
});

/** Remove a member from their workspace. Root only. */
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  await removeMemberAsRoot(auth.user.id, id);
  return ok({ ok: true });
});
