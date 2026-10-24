import { loadRootLifecycle } from '@/modules/root/server/admin/lifecycle';
import { rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async (request, actorId) => { searchParamsObject(request); return loadRootLifecycle(actorId); });
