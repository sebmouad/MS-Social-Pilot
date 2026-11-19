import { photoFigures, readPhotosNow } from '@/modules/feeds/server/wordpress-cockpit';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
export const dynamic = 'force-dynamic';

/** Read a batch of published photos now (2026-11-18), with what happened. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await readPhotosNow(actor, await readJson(request, 'Confirm reading the photos.'))); }
  catch (error) { return failure(error, 'The photos could not be read.'); }
}

/** How the recipe photos were rated (read-only, 2026-11-19). */
export async function GET() {
  const actor = await viewerActor(false); if (actor instanceof Response) return actor;
  try { return reply(await photoFigures(actor)); }
  catch (error) { return failure(error, 'The photo figures could not be read.'); }
}
