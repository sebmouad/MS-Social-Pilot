import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { searchRecord } from '@/modules/ads/analysis/query';
import { readAdsPerformance } from '@/modules/ads/server/performance';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true }).catch(() => { throw new OperationError('unauthorized', 'Sign in to an authorized workspace.'); });
    return Response.json(await readAdsPerformance({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, searchRecord(request.url, ['offset', 'limit', 'accountOffset'])), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const safe = operationFailure(error, 'Ads performance could not be loaded.');
    return Response.json({ error: safe.error, code: safe.code }, { status: safe.status, headers: { 'cache-control': 'no-store' } });
  }
}
