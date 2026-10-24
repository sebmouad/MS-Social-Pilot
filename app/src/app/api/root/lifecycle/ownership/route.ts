import { transferWorkspaceOwnership } from '@/modules/root/server/admin/lifecycle';
import { readBody, rootRoute } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';

export const POST = rootRoute({ write: true }, async (request, actorId) => transferWorkspaceOwnership(actorId, await readBody(request)));
