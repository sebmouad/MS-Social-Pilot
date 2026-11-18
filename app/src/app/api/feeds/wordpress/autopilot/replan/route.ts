import { refreshPlanWithMemory } from '@/modules/feeds/server/wordpress-cockpit';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
export const dynamic = 'force-dynamic';

/** Re-plan tomorrow and the day after with each Page's memory (2026-11-18): recipes expected below usual are replaced. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await refreshPlanWithMemory(actor, await readJson(request, 'Confirm the re-planning.'))); }
  catch (error) { return failure(error, 'The plan could not be refreshed.'); }
}
