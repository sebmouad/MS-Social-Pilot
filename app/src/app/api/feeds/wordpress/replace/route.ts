import { changeRecipeSlotNow } from '@/modules/feeds/server/wordpress';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
export const dynamic = 'force-dynamic';

/** Change one upcoming planned recipe slot: another recipe, a chosen recipe, leave empty, fill again, or never post its recipe (2026-11-15). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await changeRecipeSlotNow(actor, await readJson(request, 'Confirm the change.'))); }
  catch (error) { return failure(error, 'This time could not be changed.'); }
}
