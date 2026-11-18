import { REFRESH_PLAN_CONFIRMATION, refreshPlanWithMemory } from '@/modules/feeds/server/wordpress-cockpit';
import { OperationError } from '@/lib/operation-error';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/feeds/server/http';
export const dynamic = 'force-dynamic';

/** Re-plan tomorrow and the day after with each Page's memory (2026-11-18): recipes expected below usual are replaced. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor(true); if (actor instanceof Response) return actor;
  try {
    const body = await readJson(request, 'Confirm the re-planning.');
    // Each replacement re-plans a slot (several seconds each): the work goes on after the answer; every replacement
    // is written in the autopilot's activity log (2026-11-18).
    if ((body as { confirmation?: unknown })?.confirmation !== REFRESH_PLAN_CONFIRMATION) throw new OperationError('invalid_request', 'Confirm the re-planning.');
    void refreshPlanWithMemory(actor, body).catch(() => undefined);
    return reply({ started: true });
  }
  catch (error) { return failure(error, 'The plan could not be refreshed.'); }
}
