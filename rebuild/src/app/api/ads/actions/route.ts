import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { updateWorkspaceAd } from '@/server/ads/actions';
import { withWorkspaceOperation } from '@/server/data-control/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  adAccountId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  objectId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  objectType: z.enum(['campaign', 'adset', 'ad']),
  status: z.enum(['active', 'paused']).optional(),
  dailyBudgetMinor: z.number().int().positive().safe().optional(),
  lifetimeBudgetMinor: z.number().int().positive().safe().optional(),
  confirmation: z.string().max(200),
}).strict().refine(value => Number(Boolean(value.status)) + Number(value.dailyBudgetMinor !== undefined) + Number(value.lifetimeBudgetMinor !== undefined) === 1);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'ads/campaigns' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = schema.parse(await request.json());
    await withWorkspaceOperation(viewer.workspaceId, () => updateWorkspaceAd({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input));
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return actionError(error);
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function actionError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid ads action.' }, { status: 400 });
  if (!(error instanceof Error)) return NextResponse.json({ error: 'The ads action could not be completed.' }, { status: 500 });
  const known: Array<[string, number]> = [
    ['Confirmation required.', 400],
    ['Invalid ad', 400],
    ['Budgets must', 400],
    ['Choose one valid', 400],
    ['Only workspace owners and admins', 403],
    ['Ads management is not enabled', 403],
    ['Ads management is disabled in Root configuration', 403],
    ['Facebook platform is disabled', 403],
    ['Root has not configured', 403],
    ['Reconnect this Facebook source', 403],
    ['no longer a member', 401],
    ['cannot be verified', 404],
    ['unavailable', 409],
    ['Workspace data deletion is in progress.', 409],
  ];
  const match = known.find(([phrase]) => error.message.includes(phrase));
  return match
    ? NextResponse.json({ error: error.message }, { status: match[1], headers: { 'cache-control': 'no-store' } })
    : NextResponse.json({ error: 'The ads action could not be completed. Check the connection and try again.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
}
