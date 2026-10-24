import { listRootConnections } from '@/modules/root/server/admin/connections';
import { rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async (request, actorId) => listRootConnections(actorId, searchParamsObject(request, ['q', 'provider', 'state', 'page'])));
