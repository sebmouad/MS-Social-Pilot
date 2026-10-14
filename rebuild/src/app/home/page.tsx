import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getAdAccounts, getTargets, listPosts } from '@/server/data';
import { canUseFeature } from '@/server/entitlements';

export default async function HomePage() {
  const viewer = await requireViewer({ feature: 'home/overview' });
  const showPosts = canUseFeature(viewer.entitlements, 'publishing/posts');
  const showConnections = canUseFeature(viewer.entitlements, 'settings/connections');
  const showAds = canUseFeature(viewer.entitlements, 'ads/overview');
  const [posts, targets, adAccounts] = await Promise.all([
    showPosts ? listPosts(viewer.workspaceId, 500) : Promise.resolve([]),
    showConnections ? getTargets(viewer.workspaceId) : Promise.resolve([]),
    showAds ? getAdAccounts(viewer.workspaceId) : Promise.resolve([]),
  ]);
  const published = posts.filter((post) => post.status === 'published').length;
  const scheduled = posts.filter((post) => post.status === 'scheduled').length;
  return <PageFrame module="home"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Workspace overview</p><h1>{viewer.membership.workspace.name}</h1><p>Your connected channels and recent publishing activity.</p></div></header>
    <dl className="metric-grid">
      {showConnections && <div className="metric-card"><dt>Connected channels</dt><dd>{targets.length}</dd></div>}
      {showAds && <div className="metric-card"><dt>Linked ad accounts</dt><dd>{adAccounts.length}</dd></div>}
      {showPosts && <><div className="metric-card"><dt>Published posts</dt><dd>{published}</dd></div><div className="metric-card"><dt>Scheduled posts</dt><dd>{scheduled}</dd></div></>}
    </dl>
    {showPosts && <p className="small-note">Post counts cover the {posts.length} most recently scheduled or created posts.</p>}
    <section className="panel"><h2>Continue your work</h2><div className="quick-links">
      {showPosts && <a href="/publishing/posts">Browse posts</a>}
      {showConnections && <a href="/settings/connections">View connections</a>}
      {canUseFeature(viewer.entitlements, 'analytics/overview') && <a href="/analytics">Explore analytics</a>}
      {showAds && <a href="/ads">View ad accounts</a>}
    </div></section>
  </div></PageFrame>;
}
