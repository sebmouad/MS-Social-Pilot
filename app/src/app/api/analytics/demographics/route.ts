import { readDemographics } from '@/modules/analytics/demographics/server/demographics';
import { failure, paramsObject, reply, unauthorized, viewerActor } from '@/modules/analytics/http';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('analytics/demographics', false); if (!actor) return unauthorized();
  try {
    const data = await readDemographics(actor, paramsObject(request.url));
    if (data.csv !== null) return new Response(data.csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="audience-history.csv"', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
    return reply(data);
  }
  catch (error) { return failure(error, 'Audience breakdowns could not be loaded. Please try again.'); }
}
