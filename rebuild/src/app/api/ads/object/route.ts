import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { readWorkspaceAdObject } from '@/server/ads/actions';
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
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid ad object request.' }, { status: 400 });
    if (!(error instanceof Error)) return NextResponse.json({ error: 'The ad object could not be read.' }, { status: 500 });
    const known: Array<[string, number]> = [
      ['Invalid ad object', 400], ['Ads performance access is unavailable', 403],
      ['cannot be verified', 404], ['unavailable', 409], ['Workspace data deletion is in progress.', 409],
    ];
    const match = known.find(([phrase]) => error.message.includes(phrase));
    return match
      ? NextResponse.json({ error: error.message }, { status: match[1], headers: { 'cache-control': 'no-store' } })
      : NextResponse.json({ error: 'The ad object could not be read. Check the connection and try again.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
