import { assignRootPlan } from '@/server/root/legacy/plans';
import { readBody, rootRoute } from '@/server/root/legacy/http';

export const runtime = 'nodejs';

export const POST = rootRoute({ write: true }, async (request, actorId) => assignRootPlan(actorId, await readBody(request)));
