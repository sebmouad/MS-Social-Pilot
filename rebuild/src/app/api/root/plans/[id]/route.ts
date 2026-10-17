import { updateRootPlan } from '@/server/root/legacy/plans';
import { readBody, rootRoute } from '@/server/root/legacy/http';

export const runtime = 'nodejs';

export const PATCH = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, { params }) => {
  const { id } = await params;
  return updateRootPlan(actorId, id, await readBody(request));
});
