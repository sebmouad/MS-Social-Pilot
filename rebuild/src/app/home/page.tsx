import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { canUseFeature } from '@/server/entitlements';

export default async function HomePage() {
  const viewer = await requireViewer({ feature: 'home/overview' });
  const showPosts = canUseFeature(viewer.entitlements, 'publishing/posts');
  const showConnections = canUseFeature(viewer.entitlements, 'settings/connections');
  const showAds = canUseFeature(viewer.entitlements, 'ads/overview');
  const scope = viewer.permissions.pageScope;
  const targetWhere = { workspaceId: viewer.workspaceId, enabled: true, ...(scope.all ? {} : { id: { in: [...scope.ids] } }) };
  const visibleTargets = await prisma.target.findMany({ where: targetWhere, select: { socialAccountId: true } });
  const socialAccountIds = [...new Set(visibleTargets.map(target => target.socialAccountId).filter((id): id is string => Boolean(id)))];
  const postScope = scope.all ? {} : { targets: { some: { targetId: { in: [...scope.ids] } } } };
  const [published, scheduled, adAccounts] = await Promise.all([
    showPosts ? prisma.post.count({ where: { workspaceId: viewer.workspaceId, status: 'published', ...postScope } }) : Promise.resolve(0),
    showPosts ? prisma.post.count({ where: { workspaceId: viewer.workspaceId, status: 'scheduled', ...postScope } }) : Promise.resolve(0),
    showAds && socialAccountIds.length ? prisma.adAccount.count({ where: { workspaceId: viewer.workspaceId, enabled: true, socialAccountId: { in: socialAccountIds } } }) : Promise.resolve(0),
  ]);
  return <PageFrame module="home"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Workspace overview</p><h1>{viewer.membership.workspace.name}</h1><p>Your connected channels and recent publishing activity.</p></div></header>
    <dl className="metric-grid">
      {showConnections && <div className="metric-card"><dt>Connected channels</dt><dd>{visibleTargets.length}</dd></div>}
      {showAds && <div className="metric-card"><dt>Linked ad accounts</dt><dd>{adAccounts}</dd></div>}
      {showPosts && <><div className="metric-card"><dt>Published posts</dt><dd>{published}</dd></div><div className="metric-card"><dt>Scheduled posts</dt><dd>{scheduled}</dd></div></>}
    </dl>
    <section className="panel"><h2>Continue your work</h2><div className="quick-links">
      {showPosts && <a href="/publishing/posts">Browse posts</a>}
      {showConnections && <a href="/settings/connections">View connections</a>}
      {canUseFeature(viewer.entitlements, 'analytics/overview') && <a href="/analytics">Explore analytics</a>}
      {showAds && <a href="/ads">View ad accounts</a>}
    </div></section>
  </div></PageFrame>;
}
