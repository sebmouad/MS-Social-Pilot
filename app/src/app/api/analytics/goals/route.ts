import { readGoals, setGoals } from '@/modules/analytics/goals/server/goals';
import { failure, paramsObject, reply, sameOrigin, unauthorized, viewerActor } from '@/modules/analytics/http';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('analytics/goals', false); if (!actor) return unauthorized();
  try { return reply(await readGoals(actor, paramsObject(request.url))); }
  catch (error) { return failure(error, 'Goals could not be loaded. Please try again.'); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('analytics/goals', false); if (!actor) return unauthorized();
  try { return reply(await setGoals(actor, await request.json())); }
  catch (error) { return failure(error, 'Your goals could not be saved.'); }
}
