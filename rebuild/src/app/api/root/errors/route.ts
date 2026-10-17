import { listRootErrors } from '@/server/root/legacy/errors';
import { rootRoute, searchParamsObject } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async (request, actorId) => listRootErrors(actorId, searchParamsObject(request, ['status', 'source', 'q', 'page'])));
