import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, route } from '@/lib/api';
import { EXPORT_KINDS, buildExport, type ExportKind } from '@/lib/analytics-export';
import { csvFilename, parseReportRange } from '@/lib/reports';

/**
 * CSV export of any part of the analytics catalogue.
 *
 * `?kind=posts` is the one people usually want: one row per post, one column
 * per metric Graph returned. The rest cover the edges and the other providers.
 */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);

  const kind = (url.searchParams.get('kind') ?? 'posts') as ExportKind;
  if (!EXPORT_KINDS.includes(kind)) {
    return fail(`Unknown export. Choose one of: ${EXPORT_KINDS.join(', ')}.`, 400);
  }

  const range = parseReportRange({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    timeZone: auth.workspace.timezone,
  });
  if (!range.ok) return fail(range.message, 400);
  const { from, to } = range;

  // A target id arrives from the client, so it is checked against the caller's
  // workspace before it reaches a query.
  const requestedTarget = url.searchParams.get('targetId');
  if (requestedTarget) {
    const owned = await prisma.target.findFirst({
      where: { id: requestedTarget, workspaceId: auth.workspace.id },
      select: { id: true },
    });
    if (!owned) return fail('Destination not found.', 404);
  }

  const csv = await buildExport(kind, {
    workspaceId: auth.workspace.id,
    from,
    to,
    targetId: requestedTarget ?? undefined,
  });

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFilename(kind, auth.workspace.slug, range)}"`,
    },
  });
});
