import { approveAutopilotDay } from '@/modules/feeds/server/wordpress-cockpit';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
export const dynamic = 'force-dynamic';

/** Approve a day's recipe plan on the autopilot board (2026-11-16). The posts go out as planned either way. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try { return reply(await approveAutopilotDay(actor, await readJson(request, 'Confirm the plan to approve.'))); }
  catch (error) { return failure(error, 'The plan could not be approved.'); }
}
