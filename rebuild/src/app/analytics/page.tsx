import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { buildAnalytics } from '@/server/analytics/aggregate';
import { analyticsRange, loadAnalytics } from '@/server/analytics/data';
import { prisma } from '@/server/data';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';

type Search = { start?: string; end?: string; filter?: string; channel?: string | string[]; adFilter?: string; adAccount?: string | string[] };
const inputDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function formatValue(value: number | null, unit: string) {
  if (value === null) return '—';
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(value);
  return unit === 'percent' ? `${amount}%` : unit === 'multiple' ? `${amount}×` : amount;
}

function MetricChart({ metric }: { metric: ReturnType<typeof buildAnalytics>['metrics'][number] }) {
  const sourceLabel = metric.source === 'page' ? 'Page performance' : metric.source === 'instagram' ? 'Instagram performance' : 'Advertising';
  const detailLabel = metric.source === 'page' ? 'Page' : metric.source === 'instagram' ? 'Instagram account' : 'ad account';
  const coverageLabel = metric.source === 'page' ? 'Pages' : metric.source === 'instagram' ? 'Instagram accounts' : 'ad accounts';
  const maximum = Math.max(1, ...metric.points.map(point => point.value));
  return <div className="analytics-metric" key={metric.key}>
    <div className="analytics-metric__heading"><div><h3>{metric.label}</h3><p>{sourceLabel} · {metric.coverage} of {metric.available} covered{metric.latestAt ? ` · data ${metric.latestAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}{metric.updatedAt ? ` · synced ${metric.updatedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</p></div><strong>{metric.displayTotal ?? (metric.kind === 'breakdown' ? 'By category' : formatValue(metric.total, metric.unit))}</strong></div>
    {metric.points.length > 0 && <div className="analytics-spark" role="img" aria-label={`${metric.label} over the selected date range`}>
      {metric.points.slice(-28).map(point => <span key={point.date} title={`${point.label}: ${formatValue(point.value, metric.unit)}`} style={{ height: `${Math.max(4, point.value / maximum * 100)}%` }} />)}
    </div>}
    {metric.points.length > 0 && <details className="analytics-metric__details"><summary>View date and value series</summary><div className="report-list">{metric.points.map(point => <div className="report-row" key={point.date}><span>{point.label}</span><strong>{formatValue(point.value, metric.unit)}</strong></div>)}</div></details>}
    {metric.rows.length > 0 && <details className="analytics-metric__details"><summary>{metric.kind === 'breakdown' ? 'View breakdown' : `View ${metric.rows.length} ${detailLabel} details`}</summary><div className="report-list">{metric.rows.slice(0, 30).map(row => <div className="report-row" key={row.label}><span>{row.label}</span><strong>{formatValue(row.value, metric.unit)}{row.asOf ? ` · ${row.asOf.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</strong></div>)}</div></details>}
    {metric.points.length === 0 && metric.rows.length === 0 && <p className="empty-note">No values are available for this metric in the selected period.</p>}
    {metric.coverage < metric.available && <p className="analytics-coverage">Values were found for {metric.coverage} of {metric.available} selected {coverageLabel} in this date range.</p>}
  </div>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { workspaceId, permissions, entitlements } = await requireViewer({ feature: 'analytics/overview' });
  const allowedTargetIds = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const params = await searchParams;
  const range = analyticsRange(params.start, params.end);
  let data: Awaited<ReturnType<typeof loadAnalytics>> | null = null;
  try {
    const targets = await loadAnalytics(workspaceId, [], range, allowedTargetIds);
    const requested = new Set(Array.isArray(params.channel) ? params.channel : params.channel ? [params.channel] : []);
    const selectedIds = targets.targets.filter(target => params.filter !== '1' || requested.has(target.id)).map(target => target.id);
    const requestedAdIds = Array.isArray(params.adAccount) ? params.adAccount : params.adAccount ? [params.adAccount] : [];
    data = await loadAnalytics(workspaceId, selectedIds, range, allowedTargetIds, params.adFilter === '1' ? requestedAdIds : undefined);
  } catch (error) {
    console.error('Analytics data could not be loaded', error);
  }

  const selected = data?.selectedTargets ?? [];
  const selectedSet = new Set(selected.map(target => target.id));
  const view = data ? buildAnalytics(data.pageRows, data.adRows, data.audienceRows, selected, data.adAccountCount, data.instagramRows, data.selectedInstagramAudience) : null;
  const audienceMissing = selected.filter(channel => ['page', 'instagram'].includes(channel.type) && !view?.audience.entries.some(entry => entry.id === channel.id));
  const publishingByStatus = selected.length ? await prisma.post.groupBy({
    by: ['status'],
    where: {
      workspaceId,
      targets: { some: { targetId: { in: selected.map(channel => channel.id) } } },
      OR: [
        { status: 'published', publishedAt: { gte: range.from, lte: range.to } },
        { status: 'scheduled', scheduledAt: { gte: range.from, lte: range.to } },
        { status: { in: ['failed', 'partially_failed'] }, createdAt: { gte: range.from, lte: range.to } },
      ],
    },
    _count: { _all: true },
  }) : [];
  const countStatus = (status: string) => publishingByStatus.find(row => row.status === status)?._count._all ?? 0;
  const publishingCounts = {
    published: countStatus('published'),
    scheduled: countStatus('scheduled'),
    failed: countStatus('failed') + countStatus('partially_failed'),
  };
  const exportParams = new URLSearchParams({ start: inputDate(range.from), end: inputDate(range.to), filter: '1' });
  selected.forEach(target => exportParams.append('channel', target.id));
  exportParams.set('adFilter', '1');
  data?.selectedAdIds.forEach(id => exportParams.append('adAccount', id));
  const canExport = selected.length > 0 && canUseFeature(entitlements, 'analytics/reports') && canAccessFeature(permissions, 'analytics/reports');
  const sidebar = <form action="/analytics" method="get" className="analytics-sidebar-filter">
    <p className="analytics-filter-heading">Filters</p>
    <p className="shell-subnav__label">Date range</p>
    <label className="analytics-date-filter">From<input type="date" name="start" defaultValue={inputDate(range.from)} /></label>
    <label className="analytics-date-filter">To<input type="date" name="end" defaultValue={inputDate(range.to)} /></label>
    <fieldset className="analytics-channel-group"><legend className="shell-subnav__label">Channels</legend><input type="hidden" name="filter" value="1" />
    {data?.targets.length ? data.targets.map(target => <label key={target.id}><input type="checkbox" name="channel" value={target.id} defaultChecked={selectedSet.has(target.id)} /><span>{target.name}</span></label>) : <p className="small-note">No channels connected.</p>}</fieldset>
    {data?.adAccounts.length ? <fieldset className="analytics-channel-group"><legend className="shell-subnav__label">Ad accounts</legend><input type="hidden" name="adFilter" value="1" />
      {data.adAccounts.map(account => <label key={account.id}><input type="checkbox" name="adAccount" value={account.id} defaultChecked={data.selectedAdIds.includes(account.id)} /><span>{account.name}{account.currency ? ` · ${account.currency}` : ''}</span></label>)}
    </fieldset> : null}
    <button type="submit">Apply filters</button>
    <a className="analytics-filter-reset" href="/analytics">Reset filters</a>
  </form>;

  return <PageFrame module="analytics" sidebar={sidebar}><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Analytics</p><h1>Performance</h1><p>Stored channel and advertising metrics from {range.from.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} to {range.to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.</p></div>{canExport && <a className="button button-secondary" href={`/api/reports/export?${exportParams}`}>Export CSV</a>}</header>
    {!data || !view ? <section className="panel analytics-state"><h2>Analytics could not be loaded</h2><p>Please try again in a moment.</p></section> : <>
      {!selected.length ? <section className="panel analytics-state"><h2>{data.targets.length ? 'No channels selected' : 'No channels connected'}</h2><p>{data.targets.length ? 'Choose one or more channels in the sidebar to see available metrics.' : 'Connect a channel to see its audience and available metrics here.'}</p>{!data.targets.length && canUseFeature(entitlements, 'settings/connections') && <a className="analytics-state__action" href="/settings/connections">View connections</a>}</section> : <>
        <section className="panel analytics-audience"><div className="analytics-panel-title"><div><h2>Selected channel audience</h2><p className="small-note">The latest stored follower or Page-like count is included once for each channel with audience data.</p></div><span className="badge">{view.audience.covered} of {view.audience.selected} channels</span></div>
          <div className="analytics-audience__total"><strong>{new Intl.NumberFormat().format(view.audience.total)}</strong><span>total audience across channels with data</span></div>
          {view.audience.entries.length ? <div className="report-list">{view.audience.entries.map(entry => <div className="report-row" key={entry.id}><span>{entry.name}<small> {entry.metric === 'page_fans' ? 'Page likes' : 'Followers'}</small></span><strong>{new Intl.NumberFormat().format(entry.value)} · data {entry.asOf.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · synced {entry.fetchedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>)}</div> : <p className="empty-note">No audience counts are stored for the selected channels.</p>}
          {audienceMissing.length > 0 && <p className="analytics-coverage">No stored audience count for: {audienceMissing.map(channel => channel.name).join(', ')}.</p>}
          <p className="small-note">Counts are added across channels. People who follow more than one selected Page may be counted more than once.</p>
        </section>
        {data.adAccounts.length > 0 && <p className="small-note analytics-ad-coverage">{data.adAccountCount ? `Advertising data was found for ${new Set(data.adRows.map(row => row.adAccount.id)).size} of ${data.adAccountCount} selected ad accounts in this date range.` : 'No ad accounts selected. Choose accounts in the sidebar to include advertising metrics.'}</p>}
        {view.metrics.length ? <section className="panel"><div className="analytics-panel-title"><div><h2>Available metrics</h2><p className="small-note">Each chart and table is built from metrics already stored for this workspace.</p></div><span className="badge">{view.metrics.length} metrics</span></div>
          <div className="analytics-metrics">{view.metrics.map(metric => <MetricChart metric={metric} key={`${metric.source}:${metric.key}`} />)}</div>
        </section> : <section className="panel analytics-state"><h2>No metrics for this selection yet</h2><p>Try another date range or channel. New connections may take time to show performance data; advertising results appear when a connected ad account has data.</p></section>}
      <section className="panel"><div className="analytics-panel-title"><div><h2>Publishing records</h2><p className="small-note">Workspace posts matched to the selected channels and date range. Published posts use their publish date, scheduled posts use their scheduled date, and failed posts use their creation date.</p></div></div>
        <div className="metric-grid"><article className="metric-card"><dl><dt>Published</dt><dd>{publishingCounts.published}</dd></dl></article><article className="metric-card"><dl><dt>Scheduled</dt><dd>{publishingCounts.scheduled}</dd></dl></article><article className="metric-card"><dl><dt>Failed or partial</dt><dd>{publishingCounts.failed}</dd></dl></article></div>
      </section>
      </>}
    </>}
  </div></PageFrame>;
}
