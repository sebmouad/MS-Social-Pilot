import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { syncAnalyticsNow } from '@/modules/analytics/server/sync-now';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Sync now (Insights or Ads): this workspace's analytics read from the networks now. */
export async function POST() {
  const viewer = await requireViewer({ feature: 'analytics/overview', channelScoped: true }).catch(() => requireViewer({ feature: 'ads/campaigns', channelScoped: true })).catch(() => null);
  if (!viewer) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  try { return reply({ ok: true, ...(await syncAnalyticsNow({ userId: viewer.user.id, workspaceId: viewer.workspaceId })) }); }
  catch (error) { const failure = operationFailure(error, 'The sync could not finish. Try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
