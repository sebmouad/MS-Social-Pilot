import { ensureReportWorkflows } from '@/server/analytics/report-workflows';
import { listReportSchedules, manageReportSchedule } from '@/modules/analytics/reports/server/schedules';
import { failure, reportBody, pageParam, reply, sameOrigin, unauthorized, viewerActor } from '../_http';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('analytics/reports', false); if (!actor) return unauthorized();
  const page = pageParam(request.url); if (!page.ok) return reply({ error: 'Choose a valid result page.', code: 'invalid_request' }, 400);
  try { return reply(await listReportSchedules(actor, page.input)); }
  catch (error) { return failure(error, 'Report schedules could not be loaded. Please try again.'); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('analytics/reports', true); if (!actor) return unauthorized();
  try { await ensureReportWorkflows(); const result = await manageReportSchedule(actor, await reportBody(request)); return reply(result, result.action === 'create' ? 201 : 200); }
  catch (error) { return failure(error, 'Report schedules could not be changed.'); }
}
