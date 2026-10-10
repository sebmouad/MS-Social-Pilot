import { requireAuth, requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { createPageGroup, listPageGroups, pageGroupSchema } from '@/lib/page-groups';
import { ok, readJson, route } from '@/lib/api';

/** The workspace's Page groups, with the Pages this member may see in each. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ groups: await listPageGroups(auth.workspace.id, auth.pageScope) });
});

/**
 * Make a group. Admins only, like the rest of how the workspace is arranged:
 * a group decides what everybody's composer offers in one click.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const input = pageGroupSchema.parse(await readJson(request));
  return ok({ group: await createPageGroup(auth.workspace.id, input) }, 201);
});
