import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getPageInsightRows, listPosts } from '@/server/data';

const day = 24 * 60 * 60 * 1000;
const dateLabel = (date: Date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default async function AnalyticsPage() {
  const { workspaceId } = await requireViewer();
  const posts = await listPosts(workspaceId, 500);
  const pageInsights = await getPageInsightRows(workspaceId, 30);
  const now = Date.now();
  const since = now - 30 * day;
  const recent = posts.filter((post) => post.publishedAt && post.publishedAt.getTime() >= since);
  const scheduled = posts.filter((post) => post.status === 'scheduled');
  const publishedTotal = posts.filter((post) => post.status === 'published' || post.status === 'partially_failed').length;
  const channels = new Set(recent.flatMap((post) => post.targets.filter((target) => target.status === 'published').map((target) => target.target.id))).size;
  const bars = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(now - (6 - index) * 7 * day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 7 * day);
    return { label: `${dateLabel(start)}–${dateLabel(new Date(end.getTime() - day))}`, value: posts.filter((post) => post.publishedAt && post.publishedAt >= start && post.publishedAt < end).length };
  });
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const additiveLabels: Record<string, string> = {
    page_impressions: 'Page impressions',
    page_post_engagements: 'Post engagements',
    page_daily_follows_unique: 'Daily follows',
    page_daily_unfollows_unique: 'Daily unfollows',
    page_media_view: 'Media views',
  };
  const totals = new Map<string, number>();
  for (const row of pageInsights) if (row.numeric !== null && additiveLabels[row.metric]) {
    totals.set(row.metric, (totals.get(row.metric) ?? 0) + row.numeric);
  }
  const reachRows = new Map<string, { name: string; value: number; date: Date }>();
  for (const row of pageInsights) if (row.numeric !== null && ['page_impressions_unique', 'page_reach'].includes(row.metric)) {
    const previous = reachRows.get(row.target.id);
    if (!previous || row.endTime > previous.date) reachRows.set(row.target.id, { name: row.target.name, value: row.numeric, date: row.endTime });
  }
  const number = new Intl.NumberFormat();

  return <PageFrame module="analytics"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Analytics</p><h1>Publishing activity</h1><p>Publishing history and stored Page performance for the last 30 days.</p></div></header>
    <section className="metric-grid" aria-label="Publishing metrics">
      <article className="metric-card"><dl><dt>Published in last 30 days</dt><dd>{recent.length}</dd></dl></article>
      <article className="metric-card"><dl><dt>Scheduled now</dt><dd>{scheduled.length}</dd></dl></article>
      <article className="metric-card"><dl><dt>Published records in latest 500</dt><dd>{publishedTotal}</dd></dl></article>
      <article className="metric-card"><dl><dt>Active channels in last 30 days</dt><dd>{channels}</dd></dl></article>
    </section>
    <section className="panel"><div className="analytics-panel-title"><div><h2>Published posts by week</h2><p className="small-note">Seven rolling weeks, counted by publication date.</p></div><span className="badge">Post activity</span></div>
      <div className="activity-chart" role="img" aria-label={bars.map((bar) => `${bar.label}: ${bar.value} posts`).join('; ')}>{bars.map((bar) => <div className="activity-chart__item" key={bar.label}><strong>{bar.value}</strong><div className="activity-chart__track"><span style={{ height: `${Math.max(4, bar.value / max * 100)}%` }} /></div><small>{bar.label}</small></div>)}</div>
    </section>
    <section className="panel"><div className="analytics-panel-title"><div><h2>Stored Page performance</h2><p className="small-note">Captured daily insight rows ending in the last 30 days.</p></div></div>
      {totals.size ? <div className="metric-grid">{[...totals].map(([metric, value]) => <article className="metric-card" key={metric}><dl><dt>{additiveLabels[metric]}</dt><dd>{number.format(Math.round(value))}</dd></dl></article>)}</div> : <p className="empty-note">No daily Page performance rows are stored for this period.</p>}
      {reachRows.size > 0 && <><h3>Latest reach by Page</h3><p className="small-note">Reach is unique per Page, so these figures are shown separately and are not added across channels.</p><div className="report-list">{[...reachRows.values()].map((row) => <div className="report-row" key={row.name}><span>{row.name}</span><strong>{number.format(Math.round(row.value))} · {dateLabel(row.date)}</strong></div>)}</div></>}
    </section>
  </div></PageFrame>;
}
