import { assignRootPlan } from '@/modules/root/server/admin/plans';
import { readBody, rootRoute } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';

export const POST = rootRoute({ write: true }, async (request, actorId) => assignRootPlan(actorId, await readBody(request)));
