import { readUpdates, requestUpdateNow, runningVersion } from '@/modules/root/server/updates/store';
import { rootRoute, searchParamsObject } from '@/modules/root/server/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rootRoute({}, async request => {
  searchParamsObject(request);
  const [items, running] = await Promise.all([readUpdates(), runningVersion()]);
  return { running, items: items.map(({ log: _log, ...item }) => item) };
});

/** Update now: the server updater installs the deployed branch's latest commit. */
export const POST = rootRoute({ write: true }, async (_request, actorId) => requestUpdateNow(actorId));
