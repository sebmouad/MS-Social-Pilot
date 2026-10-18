import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readAdsComparison } from '@/modules/ads/analysis/server';
import { searchRecord } from '@/modules/ads/analysis/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ feature: 'ads/compare', channelScoped: true });
    const result = await readAdsComparison({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, searchRecord(request.url));
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const failure = operationFailure(error, 'Ads comparison could not be loaded. Please try again.');
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: { 'cache-control': 'no-store' } });
  }
}
