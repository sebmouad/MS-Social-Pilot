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
  } catch (error) { return actionError(error); }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function actionError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid campaign request.' }, { status: 400 });
  if (!(error instanceof Error)) return NextResponse.json({ error: 'The campaign could not be created.' }, { status: 500 });
  const known: Array<[string, number]> = [
    ['Confirmation required.', 400], ['Campaign names', 400], ['supported campaign objective', 400],
    ['Only workspace owners and admins', 403], ['Ads management is not enabled', 403], ['Ads management is disabled', 403],
    ['Facebook platform is disabled', 403], ['Root has not configured', 403], ['Reconnect this Facebook source', 403],
    ['no longer a member', 401], ['unavailable', 409], ['Workspace data deletion is in progress.', 409],
  ];
  const match = known.find(([phrase]) => error.message.includes(phrase));
  return match ? NextResponse.json({ error: error.message }, { status: match[1], headers: { 'cache-control': 'no-store' } })
    : NextResponse.json({ error: 'The campaign could not be created. Check the connection and try again.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
}
