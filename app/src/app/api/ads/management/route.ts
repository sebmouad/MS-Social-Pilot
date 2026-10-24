import { withPlatformAdsLocale } from '@/server/platforms/host';
import { adsServiceText } from '@/modules/ads/server/copy';
import { adsLocale } from '@/modules/ads/analysis/copy';
import { adsNoDispatchMetadata } from '@/modules/ads/management/errors';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { describeAdsManagement, readAdsCreativeImage, listAdsCreativeSources, listAdsCreatives, listAdsOperations, performAdsManagement, previewAdsManagement, resolveAdsOperation } from '@/modules/ads/management/server';
import { sameOrigin, searchRecord } from '@/modules/ads/analysis/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request) {
  const locale = adsLocale(request.headers.get('accept-language'));
  return withPlatformAdsLocale(locale, async () => {
  try {
    const viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true });
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const { view, ...rest } = searchRecord(request.url, ['offset', 'limit', 'targetOffset']);
    const accountId = typeof rest.adAccountId === 'string' ? rest.adAccountId : '';
    if (view === 'creative-image') {
      const image = await readAdsCreativeImage(actor, { adAccountId: accountId, mediaId: typeof rest.mediaId === 'string' ? rest.mediaId : '' });
      return new NextResponse(new Uint8Array(image.bytes), { headers: { 'content-type': image.mimeType, 'content-length': String(image.bytes.length), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
    }
    if (view === 'capabilities') return reply(await describeAdsManagement(actor, accountId));
    if (view === 'creative-sources') return reply(await listAdsCreativeSources(actor, rest as { adAccountId: string; imageAfter?: string; targetOffset?: number }));
    if (view === 'creatives') return reply(await listAdsCreatives(actor, rest as { adAccountId: string; after?: string; limit?: number }));
    if (view === 'changes' || view === undefined) { const operations = await listAdsOperations(actor, rest); const instants = await workspaceInstantFormatter(actor.workspaceId, locale); return reply({ ...operations, items: operations.items.map(item => labelInstants(item, { createdAt: 'dateTime' }, instants)) }); }
    throw new OperationError('invalid_request', await adsServiceText('managementInvalidView', {}, locale));
  } catch (error) {
    const failure = operationFailure(error, await adsServiceText('managementLoadFailure', {}, locale));
    return reply({ error: failure.error, code: failure.code, ...adsNoDispatchMetadata(error) }, failure.status);
  }
  });
}

export async function POST(request: Request) {
  const locale = adsLocale(request.headers.get('accept-language'));
  return withPlatformAdsLocale(locale, async () => {
  if (!sameOrigin(request)) return reply({ error: await adsServiceText('managementOriginDenied', {}, locale), code: 'forbidden' }, 403);
  try {
    const viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true });
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OperationError('invalid_request', await adsServiceText('managementInvalidRequest', {}, locale));
    const { action, ...input } = body;
    if (action === 'preview') return reply(await previewAdsManagement(actor, input as never));
    if (action === 'apply') return reply(await withWorkspaceOperation(viewer.workspaceId, () => performAdsManagement(actor, input as never)));
    if (action === 'resolve') return reply(await withWorkspaceOperation(viewer.workspaceId, () => resolveAdsOperation(actor, input as never)));
    throw new OperationError('invalid_request', await adsServiceText('managementInvalidRequest', {}, locale));
  } catch (error) {
    const failure = operationFailure(error, await adsServiceText('managementOutcomeUnknown', {}, locale));
    return reply({ error: failure.error, code: failure.code, ...adsNoDispatchMetadata(error) }, failure.status);
  }
  });
}
