import { readDemographics } from '@/modules/analytics/demographics/server/demographics';
import { failure, paramsObject, reply, unauthorized, viewerActor } from '@/modules/analytics/http';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('analytics/demographics', false); if (!actor) return unauthorized();
  try { return reply(await readDemographics(actor, paramsObject(request.url))); }
  catch (error) { return failure(error, 'Audience breakdowns could not be loaded. Please try again.'); }
}
