import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { planSchema, updatePlan } from '@/lib/plans';
import { logRootActivity } from '@/lib/root';

/** Root edits a plan's prices, limits and features. */
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireRootApi();
  const { id } = await params;
  const input = planSchema.parse(await readJson(request));
  const plan = await updatePlan(id, input);
  await logRootActivity(auth.user.id, 'plan.changed', { plan: plan.name });
  return ok({ plan });
});
