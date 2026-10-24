import { listRootErrors } from '@/modules/root/server/admin/errors';
import { rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async (request, actorId) => listRootErrors(actorId, searchParamsObject(request, ['status', 'source', 'q', 'page'])));
