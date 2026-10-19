import { ensureReportWorkflows } from '@/modules/analytics/server/report-workflows';
import { runReportNow } from '@/modules/analytics/reports/generation/runs';
import { failure, reportBody, reply, sameOrigin, unauthorized, viewerActor } from '../_http';
export const dynamic = 'force-dynamic';

/** Prepares a selected channel or saved schedule report for download. Nothing is emailed. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('analytics/reports', true); if (!actor) return unauthorized();
  try { await ensureReportWorkflows(); return reply(await runReportNow(actor, await reportBody(request)), 201); }
  catch (error) { return failure(error, 'The report could not be prepared.'); }
}
