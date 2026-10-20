import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readHomeOverview } from '@/modules/home/server/overview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Same overview as the Home screen and the get_home_overview MCP tool, through the same service. */
export async function GET() {
  let viewer;
  try { viewer = await requireViewer({ module: 'home', feature: 'home/overview' }); } catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try { return reply(await readHomeOverview({ userId: viewer.user.id, workspaceId: viewer.workspaceId })); }
  catch (error) { const failure = operationFailure(error, 'Home could not be loaded. Try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
