import { listReportTemplates, manageReportTemplate } from '@/modules/analytics/reports/server/templates';
import { failure, reportBody, pageParam, reply, sameOrigin, unauthorized, viewerActor } from '../_http';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('analytics/reports', false); if (!actor) return unauthorized();
  const page = pageParam(request.url); if (!page.ok) return reply({ error: 'Choose a valid result page.', code: 'invalid_request' }, 400);
  try { return reply(await listReportTemplates(actor, page.input)); }
  catch (error) { return failure(error, 'Report templates could not be loaded. Please try again.'); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('analytics/reports', true); if (!actor) return unauthorized();
  try { const result = await manageReportTemplate(actor, await reportBody(request)); return reply(result, result.action === 'create' ? 201 : 200); }
  catch (error) { return failure(error, 'Report templates could not be changed.'); }
}
