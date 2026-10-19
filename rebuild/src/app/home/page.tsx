import { PageFrame } from '@/server/PageFrame';
import { getAdsAccountWhere } from '@/modules/ads/server/queries';
import { requireViewer } from '@/server/context';
import { getTargets, prisma } from '@/server/data';
import { canUseFeature, entitledPlatformIds } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { readPublishingSummary } from '@/modules/publishing/server/read';

export default async function HomePage() {
  const viewer = await requireViewer({ feature: 'home/overview' });
  const showPosts = canUseFeature(viewer.entitlements, 'publishing/posts') && canAccessFeature(viewer.permissions, 'publishing/posts', 'read');
  const showConnections = canUseFeature(viewer.entitlements, 'settings/connections') && canAccessFeature(viewer.permissions, 'settings/connections', 'read');
  const showAds = canUseFeature(viewer.entitlements, 'ads/overview') && canAccessFeature(viewer.permissions, 'ads/overview', 'read');
  const scope = viewer.permissions.pageScope;
  const allowedTargetIds = scope.all ? undefined : scope.ids;
  const allowedProviders = entitledPlatformIds(viewer.entitlements);
  const visibleTargets = await getTargets(viewer.workspaceId, allowedTargetIds, allowedProviders);
  const [postSummary, adAccounts] = await Promise.all([
    showPosts ? readPublishingSummary({ userId: viewer.user.id, workspaceId: viewer.workspaceId }) : Promise.resolve({ published: 0, scheduled: 0 }),
    showAds ? prisma.adAccount.count({ where: await getAdsAccountWhere(viewer.workspaceId, allowedTargetIds, allowedProviders) }) : Promise.resolve(0),
  ]);
  const { published, scheduled } = postSummary;
  return <PageFrame module="home"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Workspace overview</p><h1>{viewer.membership.workspace.name}</h1><p>Your connected channels and recent publishing activity.</p></div></header>
    <dl className="metric-grid">
      {showConnections && <div className="metric-card"><dt>Connected channels</dt><dd>{visibleTargets.length}</dd></div>}
      {showAds && <div className="metric-card"><dt>Linked ad accounts</dt><dd>{adAccounts}</dd></div>}
      {showPosts && <><div className="metric-card"><dt>Published posts</dt><dd>{published}</dd></div><div className="metric-card"><dt>Scheduled posts</dt><dd>{scheduled}</dd></div></>}
    </dl>
    {showConnections && visibleTargets.length === 0 && <section className="panel home-start" aria-labelledby="home-start-title">
      <div><p className="eyebrow">First step</p><h2 id="home-start-title">Choose the channels you want to manage</h2><p>Connect a platform, then select the channels and ad accounts to add to this workspace. Only selected sources appear in publishing and reports.</p></div>
      <a className="home-start__action" href="/settings/connections">Connect channels <span aria-hidden="true">→</span></a>
    </section>}
    <section className="panel"><h2>Continue your work</h2><div className="quick-links">
      {showPosts && <a href="/publishing/posts">Browse posts</a>}
      {showConnections && <a href="/settings/connections">View connections</a>}
      {canUseFeature(viewer.entitlements, 'analytics/overview') && canAccessFeature(viewer.permissions, 'analytics/overview', 'read') && <a href="/analytics">Explore analytics</a>}
      {showAds && <a href="/ads">View ad accounts</a>}
    </div></section>
  </div></PageFrame>;
}
