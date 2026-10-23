import { listMetricAlertFirings, listMetricAlertRules, manageMetricAlertRule } from '@/modules/analytics/alerts/server/rules';
import { failure, pageParam, reply, sameOrigin, unauthorized, viewerActor } from '@/modules/analytics/http';
import { readBoundedJson } from '@/server/http/body';
import { runtimeConfig } from '@/server/config/store';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await viewerActor('analytics/reports', false); if (!actor) return unauthorized();
  const page = pageParam(request.url); if (!page.ok) return reply({ error: 'Choose a valid result page.', code: 'invalid_request' }, 400);
  try {
    const [rules, firings] = await Promise.all([listMetricAlertRules(actor, page.input), listMetricAlertFirings(actor, { ...page.input, includeResolved: false })]);
    return reply({ ...rules, firings: firings.firings, firingsHasMore: firings.hasMore });
  }
  catch (error) { return failure(error, 'Metric alerts could not be loaded. Please try again.'); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('analytics/reports', true); if (!actor) return unauthorized();
  try {
    const result = await manageMetricAlertRule(actor, await readBoundedJson(request, await runtimeConfig('analytics.reports.requestMaxBytes')));
    return reply(result, result.action === 'create' ? 201 : 200);
  }
  catch (error) { return failure(error, 'Metric alerts could not be changed.'); }
}
