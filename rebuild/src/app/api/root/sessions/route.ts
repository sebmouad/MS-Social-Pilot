import { listRootSessions } from '@/modules/root/server/admin/sessions';
import { rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async (request, actorId) => listRootSessions(actorId, searchParamsObject(request, ['q'])));
