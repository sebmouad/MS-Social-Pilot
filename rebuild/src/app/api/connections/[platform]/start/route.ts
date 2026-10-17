import { hasPlatformCapability } from '@/server/entitlements';
import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { connectionFlow } from '@/server/platforms/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Start connecting a platform module. Owners and admins only; the module must be on. */
export async function POST(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/connections' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  const provider = (await params).platform;
  const flow = hasPlatformCapability(viewer.entitlements, provider) ? await connectionFlow(provider) : null;
  if (!flow) return NextResponse.json({ error: 'This connection is unavailable.' }, { status: 404 });
  return flow.start(request, viewer);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
