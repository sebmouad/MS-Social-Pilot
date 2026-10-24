import { readAnalyticsComparison } from '@/modules/analytics/comparison/server/comparison';
import { failure, reply, sameOrigin, unauthorized, viewerActor } from '@/modules/analytics/http';
export const dynamic = 'force-dynamic';

/** Read-only comparison; POST carries the structured groups and ranges. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('analytics/compare', false); if (!actor) return unauthorized();
  try { return reply(await readAnalyticsComparison(actor, await request.json())); }
  catch (error) { return failure(error, 'The comparison could not be loaded. Please try again.'); }
}
