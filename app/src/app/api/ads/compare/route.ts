import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { exportAdsComparison, readAdsComparison } from '@/modules/ads/analysis/server';
import { searchRecord } from '@/modules/ads/analysis/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ feature: 'ads/compare', channelScoped: true });
    const { format, exportKind, locale, ...filters } = searchRecord(request.url);
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    if (format === 'csv') {
      const exported = await exportAdsComparison(actor, filters, new Date(), { kind: exportKind, locale });
      return new Response(exported.csv, { headers: {
        'content-type': 'text/csv; charset=utf-8',
        'x-msp-export-format': 'ads-comparison-v1',
        'x-msp-export-bytes': String(exported.byteLength),
        'x-msp-row-count': String(exported.rowCount),
        'content-disposition': `attachment; filename="${exported.fileName}"`,
        'cache-control': 'no-store',
      } });
    }
    if ((format !== undefined && format !== 'json') || exportKind !== undefined || locale !== undefined) throw new OperationError('invalid_request', 'Choose a valid Ads export format.');
    const result = await readAdsComparison(actor, filters);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const failure = operationFailure(error, 'Ads comparison could not be loaded. Please try again.');
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: { 'cache-control': 'no-store' } });
  }
}
