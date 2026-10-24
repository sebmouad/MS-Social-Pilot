import { requireViewer } from '@/server/context';
import { readAnalytics } from '@/modules/analytics/server/read';
import { analyticsQuery } from '@/modules/analytics/query';
import { operationFailure } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'analytics/overview', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try {
    return reply(await readAnalytics({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, analyticsQuery(new URL(request.url).searchParams)));
  } catch (error) {
    const failure = operationFailure(error, 'Analytics could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
