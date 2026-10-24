import { requestOrigin } from '@/server/request-origin';
import { adsErrorResponse } from '@/modules/ads/server/errors';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { createWorkspaceAdSet } from '@/modules/ads/server/actions';
import { withWorkspaceOperation } from '@/server/data-control/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  adAccountId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  campaignId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  name: z.string().trim().min(1).max(100),
  dailyBudgetMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  optimizationGoal: z.string().min(1).max(100),
  confirmation: z.string().max(500),
  requestId: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
}).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.', attempt: 'not_dispatched' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'ads/campaigns' }); }
  catch { return NextResponse.json({ error: 'Not authorized.', attempt: 'not_dispatched' }, { status: 401 }); }
  try {
    const input = schema.parse(await request.json());
    const result = await withWorkspaceOperation(viewer.workspaceId, () => createWorkspaceAdSet({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input, viewer.permissions.pageScope.all));
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return adsErrorResponse(error, 'Invalid ad set request.'); }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
