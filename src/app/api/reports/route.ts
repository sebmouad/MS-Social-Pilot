import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { buildReport, reportToCsv } from '@/lib/reports';
import { ok, route } from '@/lib/api';

/** Report data as JSON, or `?format=csv` for a spreadsheet download. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);

  const toParam = url.searchParams.get('to');
  const fromParam = url.searchParams.get('from');

  const to = toParam ? new Date(toParam) : new Date();
  // Last 30 days by default: long enough to be meaningful, short enough to
  // load quickly.
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: 'Enter a valid date range.' }, { status: 400 });
  }

  const report = await buildReport({
    workspaceId: auth.workspace.id,
    timezone: auth.workspace.timezone,
    from,
    to,
  });

  if (url.searchParams.get('format') === 'csv') {
    const stamp = to.toISOString().slice(0, 10);
    return new NextResponse(reportToCsv(report), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="report-${auth.workspace.slug}-${stamp}.csv"`,
      },
    });
  }

  return ok({ report });
});
