import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/server/data';
import { requireViewer } from '@/server/context';
import { decryptSecret } from '@/server/secret-crypto';
import { configuredFacebookConfig } from '@/platforms/facebook/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const missing = () => new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });

/**
 * A Facebook Page picture, read with the Page's own token. The anonymous Graph picture address answers a
 * placeholder for restricted Pages, and CDN addresses are signed and expire, so this resolves a fresh one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const target = await prisma.target.findFirst({ where: { id, workspaceId: viewer.workspaceId, type: 'page', socialAccount: { provider: 'facebook' } }, select: { providerId: true, accessToken: true } });
  if (!target?.accessToken) return missing();
  try {
    const config = await configuredFacebookConfig();
    const token = decryptSecret(target.accessToken);
    const url = new URL(`${config.graphBaseUrl.replace(/\/+$/, '')}/${config.graphVersion}/${encodeURIComponent(target.providerId)}/picture`);
    url.searchParams.set('type', 'square');
    url.searchParams.set('redirect', '0');
    url.searchParams.set('access_token', token);
    if (config.appSecretProofEnabled && config.appSecret) url.searchParams.set('appsecret_proof', createHmac('sha256', config.appSecret).update(token).digest('hex'));
    const response = await fetch(url, { signal: AbortSignal.timeout(config.requestTimeoutMs) });
    const body = await response.json().catch(() => null) as { data?: { url?: unknown; is_silhouette?: unknown } } | null;
    const picture = body?.data?.url;
    if (!response.ok || typeof picture !== 'string' || !picture.startsWith('https://') || body?.data?.is_silhouette === true) return missing();
    return NextResponse.redirect(picture, { status: 302, headers: { 'cache-control': 'private, max-age=3600' } });
  } catch {
    return missing();
  }
}
