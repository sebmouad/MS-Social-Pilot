import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { assertPageParam } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { route } from '@/lib/api';
import { EXPORT_KINDS, buildExport, type ExportKind } from '@/lib/analytics-export';
import { csvFilename, parseReportRange } from '@/lib/reports';
import { errors } from '@/lib/errors';

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
    throw errors.unknownExport(EXPORT_KINDS.join(', '));
  }

  const range = parseReportRange({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    timeZone: auth.workspace.timezone,
  });
  if (!range.ok) throw range.error;
  const { from, to } = range;

  // A target id arrives from the client, so it is checked against the caller's
  // workspace before it reaches a query.
  const requestedTarget = url.searchParams.get('targetId');
  assertPageParam(auth.pageScope, requestedTarget);
  if (requestedTarget) {
    const owned = await prisma.target.findFirst({
      where: { id: requestedTarget, workspaceId: auth.workspace.id },
      select: { id: true },
    });
    if (!owned) throw errors.destinationNotFound();
  }

  // The same check for an ad account, which scopes the ads export to one
  // account and so to one currency.
  const requestedAdAccount = kind === 'ads' ? url.searchParams.get('adAccountId') : null;
  if (requestedAdAccount) {
    const owned = await prisma.adAccount.findFirst({
      where: { id: requestedAdAccount, workspaceId: auth.workspace.id },
      select: { id: true },
    });
    if (!owned) throw errors.adAccountNotFound();
  }

  const csv = await buildExport(kind, {
    workspaceId: auth.workspace.id,
    from,
    to,
    targetId: requestedTarget ?? undefined,
    adAccountId: requestedAdAccount ?? undefined,
  });

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFilename(kind, auth.workspace.slug, range, auth.workspace.timezone)}"`,
    },
  });
});
