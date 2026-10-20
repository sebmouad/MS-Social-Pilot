import { ensureAdsManagement } from '@/modules/ads/server/management';
import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { exportAdsDirectory, readAdsDirectory, readAdsObjectDetail } from '@/modules/ads/directory/server';
import { searchRecord } from '@/modules/ads/analysis/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Without objectId: list objects. With objectId (plus accountId and level): one object's detail. */
export async function GET(request: Request) {
  try {
    ensureAdsManagement();
    const viewer = await requireViewer({ feature: 'ads/objects', channelScoped: true });
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const query = searchRecord(request.url, ['offset', 'limit']);
    if (query.format !== undefined) {
      const { format, ...filters } = query;
      if (format !== 'csv' || filters.objectId !== undefined) throw new OperationError('invalid_request', 'Choose csv to export the object list.');
      const exported = await exportAdsDirectory(actor, filters);
      return new Response(exported.csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${exported.fileName}"`, 'cache-control': 'no-store' } });
    }
    const result = query.objectId !== undefined ? await readAdsObjectDetail(actor, query) : await readAdsDirectory(actor, query);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const failure = operationFailure(error, 'Ad objects could not be loaded. Please try again.');
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: { 'cache-control': 'no-store' } });
  }
}
