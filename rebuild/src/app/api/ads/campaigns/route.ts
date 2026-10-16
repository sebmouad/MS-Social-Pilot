import { adsErrorResponse } from '@/server/ads/errors';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { createWorkspaceAdCampaign } from '@/server/ads/actions';
import { withWorkspaceOperation } from '@/server/data-control/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  adAccountId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  name: z.string().trim().min(1).max(100),
  objective: z.string().min(1).max(100),
  confirmation: z.string().max(300),
}).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'ads/campaigns' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = schema.parse(await request.json());
    const result = await withWorkspaceOperation(viewer.workspaceId, () => createWorkspaceAdCampaign({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input));
    return NextResponse.json({ ok: true, ...result }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return adsErrorResponse(error, 'Invalid campaign request.'); }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
