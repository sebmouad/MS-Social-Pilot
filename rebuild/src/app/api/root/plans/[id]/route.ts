import { updateRootPlan } from '@/modules/root/server/admin/plans';
import { readBody, rootRoute } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';

export const PATCH = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const { id } = await params;
  return updateRootPlan(actorId, id, await readBody(request));
});
