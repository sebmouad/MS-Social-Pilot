import { listRootSessions } from '@/server/root/legacy/sessions';
import { rootRoute, searchParamsObject } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async (request, actorId) => listRootSessions(actorId, searchParamsObject(request, ['q'])));
