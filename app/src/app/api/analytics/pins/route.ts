import { changePinnedMetrics, readPinnedMetrics } from '@/modules/analytics/pins/server/pins';
import { failure, paramsObject, reply, sameOrigin, unauthorized, viewerActor } from '@/modules/analytics/http';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('analytics/pins', false); if (!actor) return unauthorized();
  try { return reply(await readPinnedMetrics(actor, paramsObject(request.url))); }
  catch (error) { return failure(error, 'Pinned metrics could not be loaded. Please try again.'); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('analytics/pins', false); if (!actor) return unauthorized();
  try { return reply(await changePinnedMetrics(actor, await request.json())); }
  catch (error) { return failure(error, 'Your pinned metrics could not be saved.'); }
}
