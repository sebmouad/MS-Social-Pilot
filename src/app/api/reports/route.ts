import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { buildReport, csvFilename, parseReportRange, reportToCsv } from '@/lib/reports';
import { ok, route } from '@/lib/api';

/** Report data as JSON, or `?format=csv` for a spreadsheet download. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);

  const range = parseReportRange({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    timeZone: auth.workspace.timezone,
  });
  // Thrown rather than returned, so it reaches the reader in their language.
  if (!range.ok) throw range.error;
  const { from, to } = range;

  const report = await buildReport({
    workspaceId: auth.workspace.id,
    timezone: auth.workspace.timezone,
    from,
    to,
  });

  if (url.searchParams.get('format') === 'csv') {
    return new NextResponse(reportToCsv(report), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${csvFilename('report', auth.workspace.slug, range, auth.workspace.timezone)}"`,
      },
    });
  }

  return ok({ report });
});
