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
    const { format, section, ...filters } = searchRecord(request.url);
    if (section !== undefined && format !== 'csv') throw new OperationError('invalid_request', 'The section option applies to CSV exports only.');
    if (section !== undefined && section !== 'objects' && section !== 'daily') throw new OperationError('invalid_request', 'Choose objects or daily.');
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    if (format === 'csv') {
      const exported = await exportAdsComparison(actor, filters, new Date(), section === 'daily' ? 'daily' : 'objects');
      return new Response(exported.csv, { headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${exported.fileName}"`,
        'cache-control': 'no-store',
      } });
    }
    const result = await readAdsComparison(actor, filters);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const failure = operationFailure(error, 'Ads comparison could not be loaded. Please try again.');
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: { 'cache-control': 'no-store' } });
  }
}
