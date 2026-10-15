import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { analyticsRange, loadAnalytics } from '@/server/analytics/data';
import { buildReportOverview } from '@/server/analytics/reports';

type Search = { start?: string; end?: string; filter?: string; channel?: string | string[] };
const dayInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const display = (value: number | null, unit: string) => value === null ? '—' : `${fmt.format(value)}${unit === 'percent' ? '%' : unit === 'multiple' ? '×' : ''}`;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { workspaceId, permissions } = await requireViewer({ feature: 'analytics/reports', channelScoped: true });
  const allowedTargetIds = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const params = await searchParams;
  const range = analyticsRange(params.start, params.end);
  const initial = await loadAnalytics(workspaceId, [], range, allowedTargetIds);
  const requested = new Set(Array.isArray(params.channel) ? params.channel : params.channel ? [params.channel] : []);
  const selectedIds = initial.targets.filter(target => params.filter !== '1' || requested.has(target.id)).map(target => target.id);
  const data = await loadAnalytics(workspaceId, selectedIds, range, allowedTargetIds);
  const view = buildReportOverview(data);
  const selected = new Set(data.selectedTargets.map(target => target.id));
  // Repeated channel params are consumed by the export route; constructing them explicitly avoids CSV scope drift.
  const exportParams = new URLSearchParams({ start: dayInput(range.from), end: dayInput(range.to), filter: '1' });
  data.selectedTargets.forEach(target => exportParams.append('channel', target.id));
  const sidebar = <form action="/reports" method="get" className="analytics-sidebar-filter">
    <p className="analytics-filter-heading">Report filters</p><p className="shell-subnav__label">Date range</p>
    <label className="analytics-date-filter">From<input type="date" name="start" defaultValue={dayInput(range.from)} /></label>
    <label className="analytics-date-filter">To<input type="date" name="end" defaultValue={dayInput(range.to)} /></label>
    <fieldset className="analytics-channel-group"><legend className="shell-subnav__label">Channels</legend><input type="hidden" name="filter" value="1" />
      {initial.targets.length ? initial.targets.map(target => <label key={target.id}><input type="checkbox" name="channel" value={target.id} defaultChecked={selected.has(target.id)} /><span>{target.name}</span></label>) : <p className="small-note">No channels connected.</p>}
    </fieldset><button type="submit">Apply filters</button><a className="analytics-filter-reset" href="/reports">Reset filters</a>
  </form>;

  return <PageFrame module="analytics" scopedAccess sidebar={sidebar}><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Analytics</p><h1>Reports</h1><p>Stored channel metrics from {range.from.toLocaleDateString()} to {range.to.toLocaleDateString()}.</p></div><a className="button button-secondary" href={`/api/reports/export?${exportParams.toString()}`}>Export CSV</a></header>
    {!data.selectedTargets.length ? <section className="panel analytics-state"><h2>{initial.targets.length ? 'No channels selected' : 'No channels connected'}</h2><p>Select channels in the sidebar to build a report from stored metrics.</p></section> : <>
      <section className="panel analytics-audience"><div className="analytics-panel-title"><div><h2>Selected channel audience</h2><p className="small-note">The latest stored follower or Page-like count is included once for each selected channel with audience data.</p></div><span className="badge">{view.audience.covered} of {view.audience.selected} channels</span></div>
        <div className="analytics-audience__total"><strong>{new Intl.NumberFormat().format(view.audience.total)}</strong><span>audience across selected channels with data</span></div>
        {view.audience.entries.length ? <div className="report-list">{view.audience.entries.map(row => <div className="report-row" key={row.id}><span>{row.name}<small>{row.metric === 'page_fans' ? 'Page likes' : 'Followers'}</small></span><strong>{new Intl.NumberFormat().format(row.value)} · data {row.asOf.toLocaleDateString()}</strong></div>)}</div> : <p className="empty-note">No audience counts are stored for this selection.</p>}
        {view.audience.covered < view.audience.selected && <p className="analytics-coverage">Audience data is missing for {view.audience.selected - view.audience.covered} selected channel(s).</p>}
      </section>
      {view.metrics.length ? <section className="panel"><div className="analytics-panel-title"><div><h2>Available metrics</h2><p className="small-note">Metrics already stored for the selected channels and date range.</p></div><span className="badge">{view.metrics.length} metrics</span></div>
        <div className="analytics-metrics">{view.metrics.map(metric => <article className="analytics-metric" key={metric.key}><div className="analytics-metric__heading"><div><h3>{metric.label}</h3><p>{metric.source} · {metric.coverage} of {metric.available} covered</p></div><strong>{metric.displayTotal ?? (metric.kind === 'breakdown' ? 'By category' : display(metric.total, metric.unit))}</strong></div>
          {metric.points.length > 0 && <details className="analytics-metric__details"><summary>View date and value series</summary><div className="report-list">{metric.points.map(point => <div className="report-row" key={point.date}><span>{point.date}</span><strong>{display(point.value, metric.unit)}</strong></div>)}</div></details>}
          {metric.rows.length > 0 && <details className="analytics-metric__details"><summary>{metric.kind === 'breakdown' ? 'View breakdown' : `View ${metric.rows.length} channel details`}</summary><div className="report-list">{metric.rows.slice(0, 30).map(row => <div className="report-row" key={row.label}><span>{row.label}</span><strong>{display(row.value, metric.unit)}</strong></div>)}</div></details>}
        </article>)}</div>
      </section> : <section className="panel analytics-state"><h2>No stored metrics for this selection</h2><p>Try another date range or channel. New connections may take time to show performance data.</p></section>}
    </>}
  </div></PageFrame>;
}
