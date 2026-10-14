import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getAdAccounts, getTargets, listPosts } from '@/server/data';

export default async function HomePage() {
  const viewer = await requireViewer();
  const [posts, targets, adAccounts] = await Promise.all([
    listPosts(viewer.workspaceId, 500),
    getTargets(viewer.workspaceId),
    getAdAccounts(viewer.workspaceId),
  ]);
  const published = posts.filter((post) => post.status === 'published').length;
  const scheduled = posts.filter((post) => post.status === 'scheduled').length;
  return <PageFrame module="home"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Workspace overview</p><h1>{viewer.membership.workspace.name}</h1><p>Your connected channels and recent publishing activity.</p></div></header>
    <dl className="metric-grid">
      <div className="metric-card"><dt>Connected channels</dt><dd>{targets.length}</dd></div>
      <div className="metric-card"><dt>Linked ad accounts</dt><dd>{adAccounts.length}</dd></div>
      <div className="metric-card"><dt>Published posts</dt><dd>{published}</dd></div>
      <div className="metric-card"><dt>Scheduled posts</dt><dd>{scheduled}</dd></div>
    </dl>
    <p className="small-note">Post counts cover the {posts.length} most recently scheduled or created posts.</p>
    <section className="panel"><h2>Continue your work</h2><div className="quick-links"><a href="/publishing/posts">Browse posts</a><a href="/settings/connections">View connections</a><a href="/analytics">Explore analytics</a><a href="/ads">View ad accounts</a></div></section>
  </div></PageFrame>;
}
