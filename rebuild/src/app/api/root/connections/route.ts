import { listRootConnections } from '@/server/root/legacy/connections';
import { rootRoute, searchParamsObject } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async (request, actorId) => listRootConnections(actorId, searchParamsObject(request, ['q', 'provider', 'state', 'page'])));
