import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { analyticsQuery } from '@/modules/analytics/query';
import { readAnalyticsExplorer } from '@/modules/analytics/server/explorer';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'analytics/explorer', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    return reply(await readAnalyticsExplorer({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, analyticsQuery(new URL(request.url).searchParams), {
      allowedChannelIds: viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, feature: 'analytics/explorer',
    }));
  } catch (error) {
    const failure = operationFailure(error, 'Analytics Explorer could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
