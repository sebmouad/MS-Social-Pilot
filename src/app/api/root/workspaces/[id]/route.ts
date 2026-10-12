import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { MODULE_KEYS, type ModuleKey } from '@/lib/modules';
import { deleteWorkspaceAsRoot, renameWorkspace, setWorkspaceDeveloperFeatures, setWorkspaceModules, setWorkspaceSuspended } from '@/lib/root';

const schema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  suspended: z.boolean().optional(),
  developerFeatures: z.boolean().optional(),
  disabledModules: z.array(z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]])).optional(),
});

/** Rename, suspend or resume a workspace, or switch its modules. Root only (404 for everyone else). */
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const body = schema.parse(await readJson(request));
  if (body.name !== undefined) await renameWorkspace(auth.user.id, id, body.name);
  if (body.suspended !== undefined) await setWorkspaceSuspended(auth.user.id, id, body.suspended);
  if (body.developerFeatures !== undefined) await setWorkspaceDeveloperFeatures(auth.user.id, id, body.developerFeatures);
  if (body.disabledModules !== undefined) await setWorkspaceModules(auth.user.id, id, body.disabledModules);
  return ok({ ok: true });
});

/** Delete a workspace and everything in it. Root only (404 for everyone else). */
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  await deleteWorkspaceAsRoot(auth.user.id, id);
  return ok({ ok: true });
});
