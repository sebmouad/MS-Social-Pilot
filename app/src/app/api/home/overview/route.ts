import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { readHomeOverview } from '@/modules/home/server/overview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Same overview as the Home screen and the get_home_overview MCP tool, through the same service. `channel` narrows to sidebar-selected channels. */
export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ module: 'home', feature: 'home/overview' }); } catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'channel' || query.getAll(key).length > 1)) throw new OperationError('invalid_request', 'Choose a valid channel scope.');
    const raw = query.get('channel');
    if (raw !== null && !/^[A-Za-z0-9_.,-]{1,2000}$/.test(raw)) throw new OperationError('invalid_request', 'Choose a valid channel scope.');
    const channelIds = raw ? raw.split(',').map(id => id.trim()).filter(Boolean) : undefined;
    return reply(await readHomeOverview({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, new Date(), channelIds ? { channelIds } : {}));
  } catch (error) { const failure = operationFailure(error, 'Home could not be loaded. Try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
