import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { buildAnalytics } from '@/server/analytics/aggregate';
import { analyticsRange, loadAnalytics } from '@/server/analytics/data';

type Search = { start?: string; end?: string; filter?: string; channel?: string | string[] };
const inputDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function formatValue(value: number | null, unit: string) {
  if (value === null) return '—';
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(value);
  return unit === 'percent' ? `${amount}%` : unit === 'multiple' ? `${amount}×` : amount;
}

function MetricChart({ metric }: { metric: ReturnType<typeof buildAnalytics>['metrics'][number] }) {
  const maximum = Math.max(1, ...metric.points.map(point => point.value));
  return <div className="analytics-metric" key={metric.key}>
    <div className="analytics-metric__heading"><div><h3>{metric.label}</h3><p>{metric.source === 'page' ? 'Page performance' : 'Advertising'} · {metric.coverage} of {metric.available} covered{metric.latestAt ? ` · data ${metric.latestAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}{metric.updatedAt ? ` · synced ${metric.updatedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</p></div><strong>{metric.displayTotal ?? (metric.kind === 'breakdown' ? 'By category' : formatValue(metric.total, metric.unit))}</strong></div>
    {metric.points.length > 0 && <div className="analytics-spark" role="img" aria-label={`${metric.label} over the selected date range`}>
      {metric.points.slice(-28).map(point => <span key={point.date} title={`${point.label}: ${formatValue(point.value, metric.unit)}`} style={{ height: `${Math.max(4, point.value / maximum * 100)}%` }} />)}
    </div>}
    {metric.rows.length > 0 && <details className="analytics-metric__details"><summary>{metric.kind === 'breakdown' ? 'View breakdown' : `View ${metric.rows.length} ${metric.source === 'page' ? 'Page' : 'account'} details`}</summary><div className="report-list">{metric.rows.slice(0, 30).map(row => <div className="report-row" key={row.label}><span>{row.label}</span><strong>{formatValue(row.value, metric.unit)}{row.asOf ? ` · ${row.asOf.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</strong></div>)}</div></details>}
    {metric.points.length === 0 && metric.rows.length === 0 && <p className="empty-note">No values are available for this metric in the selected period.</p>}
    {metric.coverage < metric.available && <p className="analytics-coverage">Data is available for {metric.coverage} of {metric.available} selected {metric.source === 'page' ? 'Pages' : 'ad accounts'}.</p>}
  </div>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { workspaceId } = await requireViewer({ feature: 'analytics/overview' });
  const params = await searchParams;
  const range = analyticsRange(params.start, params.end);
  let data: Awaited<ReturnType<typeof loadAnalytics>> | null = null;
  try {
    const targets = await loadAnalytics(workspaceId, [], range);
    const requested = new Set(Array.isArray(params.channel) ? params.channel : params.channel ? [params.channel] : []);
    const selectedIds = targets.targets.filter(target => params.filter !== '1' || requested.has(target.id)).map(target => target.id);
    data = await loadAnalytics(workspaceId, selectedIds, range);
  } catch (error) {
    console.error('Analytics data could not be loaded', error);
  }

  const selected = data?.selectedTargets ?? [];
  const selectedSet = new Set(selected.map(target => target.id));
  const view = data ? buildAnalytics(data.pageRows, data.adRows, data.audienceRows, selected, data.adAccountCount) : null;
  const audienceMissing = selected.filter(channel => !view?.audience.entries.some(entry => entry.id === channel.id));
  const sidebar = <form action="/analytics" method="get" className="analytics-sidebar-filter">
    <p className="shell-subnav__label">Date range</p>
    <label className="analytics-date-filter">From<input type="date" name="start" defaultValue={inputDate(range.from)} /></label>
    <label className="analytics-date-filter">To<input type="date" name="end" defaultValue={inputDate(range.to)} /></label>
    <p className="shell-subnav__label">Channels</p><input type="hidden" name="filter" value="1" />
    {data?.targets.length ? data.targets.map(target => <label key={target.id}><input type="checkbox" name="channel" value={target.id} defaultChecked={selectedSet.has(target.id)} /><span>{target.name}</span></label>) : <p className="small-note">No channels connected.</p>}
    <button type="submit">Update analytics</button>
  </form>;

  return <PageFrame module="analytics" sidebar={sidebar}><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Analytics</p><h1>Performance</h1><p>Stored channel and advertising metrics from {range.from.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} to {range.to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.</p></div></header>
    {!data || !view ? <section className="panel analytics-state"><h2>Analytics could not be loaded</h2><p>Please try again in a moment.</p></section> : <>
      {!selected.length ? <section className="panel analytics-state"><h2>No channels selected</h2><p>Choose one or more channels in the sidebar to see available metrics.</p></section> : <>
        <section className="panel analytics-audience"><div className="analytics-panel-title"><div><h2>Selected channel audience</h2><p className="small-note">The latest stored follower or Page-like count is included once for each channel with audience data.</p></div><span className="badge">{view.audience.covered} of {view.audience.selected} channels</span></div>
          <div className="analytics-audience__total"><strong>{new Intl.NumberFormat().format(view.audience.total)}</strong><span>total audience across channels with data</span></div>
          {view.audience.entries.length ? <div className="report-list">{view.audience.entries.map(entry => <div className="report-row" key={entry.id}><span>{entry.name}<small> {entry.metric === 'page_follows' ? 'Followers' : 'Page likes'}</small></span><strong>{new Intl.NumberFormat().format(entry.value)} · data {entry.asOf.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · synced {entry.fetchedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>)}</div> : <p className="empty-note">No audience counts are stored for the selected channels.</p>}
          {audienceMissing.length > 0 && <p className="analytics-coverage">No stored audience count for: {audienceMissing.map(channel => channel.name).join(', ')}.</p>}
          <p className="small-note">Counts are added across channels. People who follow more than one selected Page may be counted more than once.</p>
        </section>
        {data.adAccountCount > 0 && <p className="small-note analytics-ad-coverage">Advertising insight rows are stored for {new Set(data.adRows.map(row => row.adAccount.id)).size} of {data.adAccountCount} selected ad accounts.</p>}
        {view.metrics.length ? <section className="panel"><div className="analytics-panel-title"><div><h2>Available metrics</h2><p className="small-note">Each chart and table is built from metrics already stored for this workspace.</p></div><span className="badge">{view.metrics.length} metrics</span></div>
          <div className="analytics-metrics">{view.metrics.map(metric => <MetricChart metric={metric} key={`${metric.source}:${metric.key}`} />)}</div>
        </section> : <section className="panel analytics-state"><h2>No metrics in this period</h2><p>There are no stored Page or advertising insights for the selected channels and dates.</p></section>}
      </>}
    </>}
  </div></PageFrame>;
}
