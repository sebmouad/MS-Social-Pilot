import { transferWorkspaceOwnership } from '@/server/root/legacy/lifecycle';
import { readBody, rootRoute } from '@/server/root/legacy/http';

export const runtime = 'nodejs';

export const POST = rootRoute({ write: true }, async (request, actorId) => transferWorkspaceOwnership(actorId, await readBody(request)));
