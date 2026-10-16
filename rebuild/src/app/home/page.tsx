import { PageFrame } from '@/server/PageFrame';
import { getAdsAccountWhere } from '@/server/ads/queries';
import { requireViewer } from '@/server/context';
import { getTargets, prisma } from '@/server/data';
import { canUseFeature } from '@/server/entitlements';

export default async function HomePage() {
  const viewer = await requireViewer({ feature: 'home/overview' });
  const showPosts = canUseFeature(viewer.entitlements, 'publishing/posts');
  const showConnections = canUseFeature(viewer.entitlements, 'settings/connections');
  const showAds = canUseFeature(viewer.entitlements, 'ads/overview');
  const scope = viewer.permissions.pageScope;
  const allowedTargetIds = scope.all ? undefined : scope.ids;
  const visibleTargets = await getTargets(viewer.workspaceId, allowedTargetIds);
  const postScope = scope.all ? {} : { targets: { some: { targetId: { in: [...scope.ids] } }, every: { targetId: { in: [...scope.ids] } } } };
  const [published, scheduled, adAccounts] = await Promise.all([
    showPosts ? prisma.post.count({ where: { workspaceId: viewer.workspaceId, status: 'published', ...postScope } }) : Promise.resolve(0),
    showPosts ? prisma.post.count({ where: { workspaceId: viewer.workspaceId, status: 'scheduled', ...postScope } }) : Promise.resolve(0),
    showAds ? prisma.adAccount.count({ where: await getAdsAccountWhere(viewer.workspaceId, allowedTargetIds) }) : Promise.resolve(0),
  ]);
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
      {canUseFeature(viewer.entitlements, 'analytics/overview') && <a href="/analytics">Explore analytics</a>}
      {showAds && <a href="/ads">View ad accounts</a>}
    </div></section>
  </div></PageFrame>;
}
