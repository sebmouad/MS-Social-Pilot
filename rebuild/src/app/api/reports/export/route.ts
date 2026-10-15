import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { analyticsRange, loadAnalytics } from '@/server/analytics/data';
import { buildReportOverview, reportOverviewCsv } from '@/server/analytics/reports';
import { runtimeConfig } from '@/server/config/store';

export const dynamic = 'force-dynamic';

function isCalendarDay(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'analytics/reports', channelScoped: true }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  const params = new URL(request.url).searchParams;
  const start = params.get('start');
  const end = params.get('end');
  if ((start && !isCalendarDay(start)) || (end && !isCalendarDay(end)) || (start && end && start > end)) {
    return NextResponse.json({ error: 'Choose a valid date range.' }, { status: 400 });
  }
  const range = analyticsRange(start ?? undefined, end ?? undefined);
  const allowedTargetIds = viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids;
  const initial = await loadAnalytics(viewer.workspaceId, [], range, allowedTargetIds);
  const channels = params.getAll('channel');
  const maxChannels = await runtimeConfig('analytics.reportMaxChannels');
  if (channels.length > maxChannels) return NextResponse.json({ error: `Select at most ${maxChannels} channels for one export.` }, { status: 400 });
  const adAccounts = params.getAll('adAccount');
  if (adAccounts.length > maxChannels) return NextResponse.json({ error: `Select at most ${maxChannels} ad accounts for one export.` }, { status: 400 });
  const requested = new Set(channels);
  const selectedIds = params.get('filter') === '1'
    ? initial.targets.filter(target => requested.has(target.id)).map(target => target.id)
    : initial.targets.map(target => target.id);
  const data = await loadAnalytics(viewer.workspaceId, selectedIds, range, allowedTargetIds, params.get('adFilter') === '1' ? adAccounts : undefined);
  const result = reportOverviewCsv(buildReportOverview(data), await runtimeConfig('analytics.reportExportRows'));
  const filename = `report-${start ?? 'last-30-days'}-${end ?? 'today'}.csv`;
  return new NextResponse(result.csv, { headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
    'x-export-row-count': String(result.rowCount),
    'x-export-truncated': String(result.truncated),
  } });
}
