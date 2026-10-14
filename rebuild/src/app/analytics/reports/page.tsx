import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { listPosts } from '@/server/data';

export default async function ReportsPage() {
  const { workspaceId } = await requireViewer();
  const posts = await listPosts(workspaceId, 500);
  const total = posts.length;
  const published = posts.filter((post) => post.status === 'published').length;
  const scheduled = posts.filter((post) => post.status === 'scheduled').length;
  const failed = posts.filter((post) => post.status === 'failed' || post.status === 'partially_failed').length;
  const destinationCounts = new Map<string, number>();
  for (const post of posts) for (const target of post.targets) {
    const label = target.target.name || target.target.type;
    destinationCounts.set(label, (destinationCounts.get(label) ?? 0) + 1);
  }
  const destinations = [...destinationCounts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return <PageFrame module="analytics"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Analytics / Reports</p><h1>Workspace report</h1><p>A current snapshot from the latest 500 post records.</p></div></header>
    <section className="metric-grid"><article className="metric-card"><dl><dt>Records included</dt><dd>{total}</dd></dl></article><article className="metric-card"><dl><dt>Published</dt><dd>{published}</dd></dl></article><article className="metric-card"><dl><dt>Scheduled</dt><dd>{scheduled}</dd></dl></article><article className="metric-card"><dl><dt>Failed or partial</dt><dd>{failed}</dd></dl></article></section>
    <section className="panel"><h2>Destination activity</h2>{destinations.length ? <div className="report-list">{destinations.map(([name, count]) => <div className="report-row" key={name}><span>{name}</span><strong>{count} post {count === 1 ? 'record' : 'records'}</strong></div>)}</div> : <p className="empty-note">No post destination records are available yet.</p>}</section>
    <section className="panel"><h2>Data coverage</h2><p className="empty-note">This report summarizes post records and destinations. Stored Page performance is available on Analytics overview, and advertising delivery is available under Ads. This report does not yet include a date-range picker, saved reports, or exports.</p></section>
  </div></PageFrame>;
}
