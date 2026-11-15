import { replaceRecipeSlotNow } from '@/modules/feeds/server/wordpress';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
export const dynamic = 'force-dynamic';

/** Give one upcoming planned recipe post a different recipe (2026-11-15). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await replaceRecipeSlotNow(actor, await readJson(request, 'Confirm the replacement.'))); }
  catch (error) { return failure(error, 'This post could not be given another recipe.'); }
}
