import { readUpdateLog } from '@/modules/root/server/updates/store';
import { json, rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The log of one update, fetched when Root › Updates opens it. */
export const GET = rootRoute<{ params: Promise<{ id: string }> }>({}, async (request, _actorId, context) => {
  searchParamsObject(request);
  const { id } = await context.params;
  const log = /^[A-Za-z0-9-]{1,64}$/.test(id) ? await readUpdateLog(id) : undefined;
  if (log === undefined) return json({ error: 'Not found.' }, 404);
  return { log: log ?? '' };
});
