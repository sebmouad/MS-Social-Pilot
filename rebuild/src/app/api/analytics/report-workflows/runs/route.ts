import { ensureReportWorkflows } from '@/server/analytics/report-workflows';
import { listReportRuns } from '@/modules/analytics/reports/generation/runs';
import { failure, pageParam, reply, unauthorized, viewerActor } from '../_http';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('analytics/reports', false); if (!actor) return unauthorized();
  const page = pageParam(request.url); if (!page.ok) return reply({ error: 'Choose a valid result page.', code: 'invalid_request' }, 400);
  try { await ensureReportWorkflows(); return reply(await listReportRuns(actor, page.input)); }
  catch (error) { return failure(error, 'Report history could not be loaded. Please try again.'); }
}
