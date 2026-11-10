import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { analyticsSyncState, startAnalyticsSync } from '@/modules/analytics/server/sync-now';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const viewerFor = () => requireViewer({ feature: 'analytics/overview', channelScoped: true }).catch(() => requireViewer({ feature: 'ads/campaigns', channelScoped: true })).catch(() => null);

/**
 * Sync now (Insights or Ads). POST starts reading this workspace's figures in the background and answers at once
 * (a full read used to hold the request open until a proxy cut it at 30 s); GET reports how that run is going.
 */
export async function POST() {
  const viewer = await viewerFor();
  if (!viewer) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try { return reply({ ok: true, ...startAnalyticsSync({ userId: viewer.user.id, workspaceId: viewer.workspaceId }) }, 202); }
  catch (error) { const failure = operationFailure(error, 'The sync could not start. Try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}

export async function GET() {
  const viewer = await viewerFor();
  if (!viewer) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  return reply({ ok: true, run: analyticsSyncState(viewer.workspaceId) });
}
