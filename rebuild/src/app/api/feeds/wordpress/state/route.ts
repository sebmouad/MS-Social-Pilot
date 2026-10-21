import { setRecipeSourceState } from '@/modules/feeds/server/wordpress';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await setRecipeSourceState(actor, await readJson(request, 'Choose pause or resume and confirm.'))); }
  catch (error) { return failure(error, 'The recipe source could not be changed.'); }
}
