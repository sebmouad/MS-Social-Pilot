import { changeRootMemberRole, listRootPrivileges } from '@/modules/root/server/admin/privileges';
import { readBody, rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async (request, actorId) => listRootPrivileges(actorId, searchParamsObject(request, ['q', 'role', 'workspaceId', 'page'])));
export const POST = rootRoute({ write: true }, async (request, actorId) => changeRootMemberRole(actorId, await readBody(request)));
