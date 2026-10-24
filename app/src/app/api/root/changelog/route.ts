import { addRootChangelogEntry, listRootChangelog } from '@/modules/history/server/changelog';
import { readBody, rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async (request, actorId) => { searchParamsObject(request); return listRootChangelog(actorId); });
export const POST = rootRoute({ write: true }, async (request, actorId) => addRootChangelogEntry(actorId, await readBody(request)));
