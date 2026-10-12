import { requireAuth, requireCapability } from '@/lib/auth';
import { canManageTemplates } from '@/lib/constants';
import { createTemplate, listTemplates, templateSchema } from '@/lib/post-templates-store';
import { ok, readJson, route } from '@/lib/api';

/** Post templates (NEXT_PHASES H4): everyone who writes posts picks them. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ templates: await listTemplates(auth.workspace.id) });
});

/** Shared by the whole team, so editors and up keep them. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageTemplates);
  const template = await createTemplate(auth.workspace.id, templateSchema.parse(await readJson(request)));
  return ok({ template }, 201);
});
