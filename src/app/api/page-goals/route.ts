import { requireAuth, requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { goalsOf, goalsSchema, saveGoals } from '@/lib/page-goals';
import { ok, readJson, route } from '@/lib/api';

/** A Page's monthly goals (H12), for the editor. Any member who sees the Page. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const targetId = new URL(request.url).searchParams.get('targetId');
  if (!targetId) throw errors.notFound();
  return ok({ goals: await goalsOf(auth.workspace.id, auth.pageScope, targetId) });
});

/** Set or clear them. Admins, like the Page's other settings. */
export const PUT = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  await saveGoals(auth.workspace.id, auth.pageScope, goalsSchema.parse(await readJson(request)));
  return ok({ ok: true });
});
