import { ok, readJson, route } from '@/lib/api';
import { requireCapability } from '@/lib/auth';
import { bioSchema, saveBio } from '@/lib/bio';
import { canManageSettings } from '@/lib/constants';

/** Save the workspace's link-in-bio page. */
export const PUT = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const input = bioSchema.parse(await readJson(request));
  const page = await saveBio(auth.workspace.id, input);
  return ok({ slug: page.slug });
});
