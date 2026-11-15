import { listRecipeChoices } from '@/modules/feeds/server/wordpress';
import { failure, reply, viewerActor } from '@/modules/feeds/server/http';
export const dynamic = 'force-dynamic';

/** Recipes a member can choose for one planned time (2026-11-15). */
export async function GET() {
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await listRecipeChoices(actor)); }
  catch (error) { return failure(error, 'The recipes could not be listed.'); }
}
