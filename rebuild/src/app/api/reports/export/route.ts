import { requireViewer } from '@/server/context';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import { analyticsQuery } from '@/modules/analytics/query';
import { analyticsSnapshotCsv } from '@/server/analytics/reports';
import { runtimeConfig } from '@/server/config/store';
import { operationFailure } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'analytics/reports', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const snapshot = await readAnalyticsSnapshot({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, analyticsQuery(new URL(request.url).searchParams), { feature: 'analytics/reports' });
    const result = analyticsSnapshotCsv(snapshot, await runtimeConfig('analytics.reportExportRows'));
    return new Response(result.csv, { headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="report-${snapshot.period.start}-${snapshot.period.end}.csv"`,
      'cache-control': 'no-store', 'x-export-row-count': String(result.rowCount), 'x-export-truncated': String(result.truncated),
    } });
  } catch (error) {
    const failure = operationFailure(error, 'Analytics export could not be prepared. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
