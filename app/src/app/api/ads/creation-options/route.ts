import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { searchRecord } from '@/modules/ads/analysis/query';
import { readAdsCreationOptions } from '@/modules/ads/server/creation-options';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true }).catch(() => { throw new OperationError('unauthorized', 'Sign in to an authorized workspace.'); });
    return Response.json(await readAdsCreationOptions({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, searchRecord(request.url)), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const safe = operationFailure(error, 'Ad creation options are unavailable.');
    return Response.json({ error: safe.error, code: safe.code }, { status: safe.status, headers: { 'cache-control': 'no-store' } });
  }
}
