import { requestOrigin } from '@/server/request-origin';
import { hasPlatformCapability } from '@/server/entitlements';
import { NextResponse, type NextRequest } from 'next/server';
import { requireViewer } from '@/server/context';
import { connectionFlow } from '@/server/platforms/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Finish connecting a platform module after the provider's authorization screen. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const viewer = await requireViewer({ feature: 'settings/connections' });
  const failed = NextResponse.redirect(new URL('/settings/channels?notice=connect_failed', requestOrigin(request)), { status: 303, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') { console.warn('[connections] callback refused: role'); return failed; }
  const provider = (await params).platform;
  const flow = hasPlatformCapability(viewer.entitlements, provider) ? await connectionFlow(provider) : null;
  if (!flow) { console.warn('[connections] callback refused: no_flow'); return failed; }
  return flow.callback(request, viewer);
}
