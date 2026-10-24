import { runRecipePlannerNow } from '@/modules/feeds/server/wordpress';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await runRecipePlannerNow(actor, await readJson(request, 'Confirm the planning run.'))); }
  catch (error) { return failure(error, 'Planning could not be completed.'); }
}
