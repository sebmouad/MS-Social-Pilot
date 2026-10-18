import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { describeAdsManagement, listAdsCreatives, listAdsOperations, performAdsManagement, previewAdsManagement, resolveAdsOperation } from '@/modules/ads/management/server';
import { sameOrigin, searchRecord } from '@/modules/ads/analysis/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true });
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const { view, ...rest } = searchRecord(request.url, ['offset', 'limit']);
    const accountId = typeof rest.adAccountId === 'string' ? rest.adAccountId : '';
    if (view === 'capabilities') return reply(await describeAdsManagement(actor, accountId));
    if (view === 'creatives') return reply(await listAdsCreatives(actor, rest as { adAccountId: string; after?: string; limit?: number }));
    if (view === 'changes' || view === undefined) return reply(await listAdsOperations(actor, rest));
    throw new OperationError('invalid_request', 'Choose a valid Ads management view.');
  } catch (error) {
    const failure = operationFailure(error, 'Ads management could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  try {
    const viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true });
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OperationError('invalid_request', 'Invalid Ads management request.');
    const { action, ...input } = body;
    if (action === 'preview') return reply(await previewAdsManagement(actor, input as never));
    if (action === 'apply') return reply(await withWorkspaceOperation(viewer.workspaceId, () => performAdsManagement(actor, input as never)));
    if (action === 'resolve') return reply(await withWorkspaceOperation(viewer.workspaceId, () => resolveAdsOperation(actor, input as never)));
    throw new OperationError('invalid_request', 'Invalid Ads management request.');
  } catch (error) {
    const failure = operationFailure(error, 'The change outcome is unconfirmed. Check Ads change history before repeating it.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
