import { listRootRegistration } from '@/server/root/registration-admin';
import { rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = rootRoute({}, async (request, actorId) => listRootRegistration(actorId, searchParamsObject(request, ['q', 'workspaceId', 'status', 'page', 'accountsPage'])));
