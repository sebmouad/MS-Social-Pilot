import { NextResponse, type NextRequest } from 'next/server';
import { requireViewer } from '@/server/context';
import { connectionFlow } from '@/server/platforms/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Finish connecting a platform module after the provider's authorization screen. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const viewer = await requireViewer({ feature: 'settings/connections' });
  const failed = NextResponse.redirect(new URL('/settings/connections?notice=connect_failed', request.url), { status: 303, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return failed;
  const flow = await connectionFlow((await params).platform);
  if (!flow) return failed;
  return flow.callback(request, viewer);
}
