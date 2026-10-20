import { requestOrigin } from '@/server/request-origin';
import { adsErrorResponse } from '@/modules/ads/server/errors';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { readWorkspaceAdObject } from '@/modules/ads/server/actions';
import { withWorkspaceOperation } from '@/server/data-control/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  adAccountId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  objectId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  objectType: z.enum(['campaign', 'adset', 'ad']),
}).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'ads/campaigns' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = schema.parse(await request.json());
    const allowedTargetIds = viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids;
    const object = await withWorkspaceOperation(viewer.workspaceId, () => readWorkspaceAdObject({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input, allowedTargetIds));
    return NextResponse.json({ object }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return adsErrorResponse(error, 'Invalid ad object request.');
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
