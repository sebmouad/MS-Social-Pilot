import { listRootPlanHistory, listRootPlans, listRootSubscribers } from '@/server/root/legacy/plans';
import { rootRoute, searchParamsObject } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plan catalog; ?view=history or ?view=subscribers selects the other private reads. */
export const GET = rootRoute({}, async (request, actorId) => {
  const view = searchParamsObject(request, ['view']).view;
  if (view === 'history') return listRootPlanHistory(actorId);
  if (view === 'subscribers') return listRootSubscribers(actorId);
  return listRootPlans(actorId);
});
