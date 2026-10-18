import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readAdsDirectory, readAdsObjectDetail } from '@/modules/ads/directory/server';
import { searchRecord } from '@/modules/ads/analysis/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Without objectId: list objects. With objectId (plus accountId and level): one object's detail. */
export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ feature: 'ads/objects', channelScoped: true });
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const query = searchRecord(request.url, ['offset', 'limit']);
    const result = query.objectId !== undefined ? await readAdsObjectDetail(actor, query) : await readAdsDirectory(actor, query);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const failure = operationFailure(error, 'Ad objects could not be loaded. Please try again.');
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: { 'cache-control': 'no-store' } });
  }
}
