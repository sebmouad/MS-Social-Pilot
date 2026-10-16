import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { operationFailure } from '@/lib/operation-error';
import { readAnalytics } from '@/modules/analytics/server/read';
import type { AnalyticsReadResult } from '@/modules/analytics/server/types';
import { Button } from '@/components/Button';
import AnalyticsMetric, { AnalyticsMetricComparison } from './AnalyticsMetric';
import './analytics.css';

type Search = Record<string, string | string[] | undefined>;
type ComparisonMode = 'none' | 'previous' | 'year';

function asString(value: string | string[] | undefined) {
  return Array.isArray(value) ? '' : value ?? '';
}

function appendSearchParams(params: URLSearchParams, key: string, value: string | string[] | undefined) {
  if (value === undefined) return;
  (Array.isArray(value) ? value : [value]).forEach(item => params.append(key, item));
}

function rawQuery(params: Search) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) appendSearchParams(query, key, value);
  return query.toString();
}

function updateQuery(query: string, key: string, value: string | number) {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  params.set(key, String(value));
  return params.toString();
}

function removeQuery(query: string, key: string) {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  params.delete(key);
  return params.toString();
}

function formatDay(value: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatValue(value: number, unit: string) {
  const amount = new Intl.NumberFormat('en', { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(value);
  return unit === 'percent' ? `${amount}%` : unit === 'multiple' ? `${amount}×` : amount;
}

function Pagination({ query, parameter, page, pages, label }: { query: string; parameter: string; page: number; pages: number; label: string }) {
  if (pages < 2) return null;
  return <nav className="analytics-pager" aria-label={`${label} pages`}>
    <span>Page {page} of {pages}</span>
    {page > 1 && <a href={`/analytics?${updateQuery(query, parameter, page - 1)}`}>Previous {label.toLowerCase()}</a>}
    {page < pages && <a href={`/analytics?${updateQuery(query, parameter, page + 1)}`}>Next {label.toLowerCase()}</a>}
  </nav>;
}

function AnalyticsSidebar({ data, query, exportHref, connectionsHref }: { data: AnalyticsReadResult; query: string; exportHref?: string; connectionsHref?: string }) {
  const params = new URLSearchParams(query);
  const selectedChannels = new Set(data.selected.channelIds);
  const selectedAccounts = new Set(data.selected.adAccountIds);
  const comparison = data.period.comparison?.mode ?? 'none';
  const selectedMetric = params.get('metric') ?? '';
  const freshPage = (name: string) => <input type="hidden" name={name} value="1" />;

  return <div className="analytics-sidebar">
    <form noValidate action="/analytics" method="get" className="analytics-sidebar-filter">
      <p className="analytics-filter-heading">Report filters</p>
      <fieldset className="analytics-filter-section">
        <legend className="shell-subnav__label">Stored calendar dates (UTC)</legend>
        <label className="analytics-date-filter">From<input type="date" name="start" defaultValue={data.period.start} /></label>
        <label className="analytics-date-filter">To<input type="date" name="end" defaultValue={data.period.end} /></label>
      </fieldset>
      <label className="analytics-select-filter">Compare with
        <select name="compare" defaultValue={comparison}>
          <option value="none">No comparison</option>
          <option value="previous">Previous equal-length period</option>
          <option value="year">Same calendar dates last year</option>
        </select>
      </label>
      <fieldset className="analytics-channel-group"><legend className="shell-subnav__label">Channels</legend>
        {freshPage('filter')}
        {data.options.channels.length ? data.options.channels.map(channel => <label key={channel.id}>
          <input type="checkbox" name="channel" value={channel.id} defaultChecked={selectedChannels.has(channel.id)} />
          <span>{channel.name}</span>
        </label>) : <p className="small-note">No channels available.</p>}
      </fieldset>
      <fieldset className="analytics-channel-group"><legend className="shell-subnav__label">Ad accounts</legend>
        {freshPage('adFilter')}
        {data.options.adAccounts.length ? data.options.adAccounts.map(account => <label key={account.id}>
          <input type="checkbox" name="adAccount" value={account.id} defaultChecked={selectedAccounts.has(account.id)} />
          <span>{account.name}{account.currency ? ` · ${account.currency}` : ''}</span>
        </label>) : <p className="small-note">No ad accounts available.</p>}
      </fieldset>
      <label className="analytics-select-filter">Search metrics
        <input type="search" name="search" maxLength={data.searchMaxLength} defaultValue={params.get('search') ?? ''} placeholder="Name or source" />
      </label>
      <label className="analytics-select-filter">Metric detail
        <select name="metric" defaultValue={selectedMetric}>
          <option value="" disabled>All matching metrics</option>
          {data.options.metrics.map(metric => <option value={metric.key} key={`${metric.sourceLabel}:${metric.key}`}>{metric.label} · {metric.sourceLabel}</option>)}
        </select>
      </label>
      {freshPage('page')}{freshPage('pointPage')}{freshPage('rowPage')}
      <Button type="submit" variant="primary">Apply filters</Button>
      <a className="analytics-filter-reset" href="/analytics">Reset filters</a>
    </form>

    <div className="analytics-sidebar-pages">
      <p className="shell-subnav__label">Browse results</p>
      {!data.detail && <Pagination query={data.query} parameter="page" page={data.metrics.page} pages={data.metrics.pages} label="Metrics" />}
      {data.detail && <>
        <Pagination query={data.query} parameter="pointPage" page={data.detail.points.page} pages={data.detail.points.pages} label="Series" />
        <Pagination query={data.query} parameter="rowPage" page={data.detail.rows.page} pages={data.detail.rows.pages} label="Resources" />
        <a className="analytics-sidebar-export" href={`/analytics?${removeQuery(data.query, 'metric')}`}>Back to all metric cards</a>
      </>}
      {exportHref && <><a className="analytics-sidebar-export" href={exportHref}>Export CSV</a><p className="analytics-export-note">Exports include up to {data.exportRowLimit} data rows. Larger downloads are marked as truncated.</p></>}
      {connectionsHref && <a className="analytics-sidebar-export" href={connectionsHref}>View connections</a>}
      {!data.metrics.total && <p className="small-note">No metrics match these filters.</p>}
    </div>
  </div>;
}

function AnalyticsRecoverySidebar({ retryHref }: { retryHref: string }) {
  return <div className="analytics-sidebar-pages">
    <p className="shell-subnav__label">Recovery</p>
    <a href={retryHref}>Try again with these filters</a>
    <a href="/analytics">Reset filters</a>
  </div>;
}

function MetricTable({ data }: { data: AnalyticsReadResult }) {
  const detail = data.detail!;
  const metric = detail.metric;
  const rowStart = detail.rows.total ? (detail.rows.page - 1) * detail.rows.pageSize + 1 : 0;
  const rowEnd = Math.min(detail.rows.page * detail.rows.pageSize, detail.rows.total);
  const pointStart = detail.points.total ? (detail.points.page - 1) * detail.points.pageSize + 1 : 0;
  const pointEnd = Math.min(detail.points.page * detail.points.pageSize, detail.points.total);
  const timeLabel = metric.resourceKind === 'ad-account' ? 'ad accounts' : 'channels';

  return <section className="panel analytics-detail" aria-labelledby="analytics-detail-title">
    <header className="analytics-panel-title"><div><p className="eyebrow">Metric detail</p><h2 id="analytics-detail-title">{metric.label}</h2><p className="small-note">{metric.sourceLabel} · {metric.aggregationLabel}</p>{metric.aggregationNote && <p className="analytics-aggregation-note">{metric.aggregationNote}</p>}</div>
      <strong className="analytics-detail-total">{metric.displayTotal ?? (metric.total === null ? '—' : formatValue(metric.total, metric.unit))}</strong>
    </header>
    <p className="analytics-detail-coverage">Coverage: {metric.coverage} of {metric.available} selected {timeLabel}. A missing value is unknown, not zero.</p>
    <AnalyticsMetricComparison metric={metric} comparison={data.comparisons[metric.key]} />
    <div className="analytics-table-wrap">
      <table className="analytics-table">
        <caption>Full date and value series · {detail.points.total} stored values · showing {pointStart}–{pointEnd}</caption>
        <thead><tr><th scope="col">Stored calendar date (UTC)</th><th scope="col">Value</th></tr></thead>
        <tbody>{detail.points.items.map(point => <tr key={point.date}><th scope="row" title="Stored calendar date (UTC)">{formatDay(point.date)}</th><td>{formatValue(point.value, metric.unit)}</td></tr>)}</tbody>
      </table>
      {!detail.points.total && <p className="empty-note">No dated values are stored for this metric.</p>}
    </div>
    <div className="analytics-table-wrap">
      <table className="analytics-table">
        <caption>Resource detail · {detail.rows.total} stored rows · showing {rowStart}–{rowEnd}</caption>
        <thead><tr><th scope="col">{metric.kind === 'breakdown' ? 'Category' : metric.resourceKind === 'ad-account' ? 'Ad account' : 'Channel'}</th><th scope="col">Value</th><th scope="col">Data date</th></tr></thead>
        <tbody>{detail.rows.items.map(row => <tr key={`${row.label}:${row.asOf?.toISOString() ?? 'unknown'}`}><th scope="row">{row.label}</th><td>{formatValue(row.value, metric.unit)}</td><td>{row.asOf ? formatDay(row.asOf.toISOString().slice(0, 10)) : 'Date unavailable'}</td></tr>)}</tbody>
      </table>
      {!detail.rows.total && <p className="empty-note">No resource-level values are stored for this metric.</p>}
    </div>
  </section>;
}

function audienceSection(data: AnalyticsReadResult) {
  if (!data.selected.channelIds.length) return null;
  return <section className="panel analytics-audience">
    <div className="analytics-panel-title"><div><h2>Selected channel audience</h2><p className="small-note">Latest stored audience count for each selected channel with a valid measure.</p></div><span className="badge">{data.audience.covered} of {data.audience.selected} channels</span></div>
    {data.audience.entries.length ? <>
      <div className="analytics-audience__total"><strong>{new Intl.NumberFormat('en').format(data.audience.total)}</strong><span>total audience across channels with data</span></div>
      <div className="report-list">{data.audience.entries.map(entry => <div className="report-row" key={entry.id}>
        <span>{entry.name}<small> {entry.metricLabel}</small></span>
        <strong>{new Intl.NumberFormat('en').format(entry.value)} · data {formatDay(entry.asOf.toISOString().slice(0, 10))} · synced {formatDay(entry.fetchedAt.toISOString().slice(0, 10))}</strong>
      </div>)}</div>
    </> : <p className="empty-note">No audience counts are stored for the selected channels. Missing audience data is unknown, not zero.</p>}
    <p className="small-note">Counts are added across channels. People represented in more than one audience may be counted more than once.</p>
  </section>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/overview', channelScoped: true });
  const params = await searchParams;
  let data: AnalyticsReadResult | null = null;
  let failure: ReturnType<typeof operationFailure> | null = null;
  try {
    data = await readAnalytics({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, params as Record<string, unknown>, {
      allowedChannelIds: viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids,
      feature: 'analytics/overview',
    });
  } catch (error) {
    failure = operationFailure(error, 'Analytics could not be loaded. Try again or reset the filters.');
  }

  const canExport = data !== null && (data.selected.channelIds.length > 0 || data.selected.adAccountIds.length > 0)
    && canUseFeature(viewer.entitlements, 'analytics/reports') && canAccessFeature(viewer.permissions, 'analytics/reports');
  const canManageConnections = canUseFeature(viewer.entitlements, 'settings/connections') && canAccessFeature(viewer.permissions, 'settings/connections');
  const exportQuery = data ? new URLSearchParams(data.query) : null;
  if (data && exportQuery) {
    exportQuery.delete('page'); exportQuery.delete('pointPage'); exportQuery.delete('rowPage'); exportQuery.delete('metric');
  }
  const exportHref = canExport && exportQuery ? `/api/reports/export?${exportQuery.toString()}` : undefined;
  const connectionsHref = canManageConnections ? '/settings/connections' : undefined;
  const retryQuery = rawQuery(params);
  const retryHref = `/analytics${retryQuery ? `?${retryQuery}` : ''}`;

  return <PageFrame module="analytics" scopedAccess sidebar={data ? <AnalyticsSidebar data={data} query={data.query} exportHref={exportHref} connectionsHref={!data.options.channels.length && !data.options.adAccounts.length ? connectionsHref : undefined} /> : failure ? <AnalyticsRecoverySidebar retryHref={retryHref} /> : undefined}>
    <div className="page-stack">
      <header className="page-heading"><div><p className="eyebrow">Analytics</p><h1>Performance</h1>
        {data && <><p title="These are inclusive stored calendar-date boundaries in UTC.">Stored calendar dates (UTC): {formatDay(data.period.start)} to {formatDay(data.period.end)}.</p>
          {data.period.comparison && <p>Compared with {data.period.comparison.mode === 'year' ? 'the same calendar dates last year' : 'the previous equal-length period'}: {formatDay(data.period.comparison.start)} to {formatDay(data.period.comparison.end)}.</p>}
        </>}
      </div></header>
      {failure && <section className="panel analytics-state" role="alert"><h2>Analytics could not be loaded</h2><p>{failure.error}</p><p>Use the sidebar to retry with these filters or reset them.</p></section>}
      {data && <>
        {!data.options.channels.length && !data.options.adAccounts.length
          ? <section className="panel analytics-state"><h2>No selected resources are available</h2><p>Connect or enable a channel or ad account to see its stored metrics. Use the sidebar to open Connections.</p></section>
          : (data.options.channels.length > 0 || data.options.adAccounts.length > 0) && !data.selected.channelIds.length && !data.selected.adAccountIds.length
            ? <section className="panel analytics-state"><h2>No resources selected</h2><p>Choose channels or ad accounts in the sidebar to see their stored metrics.</p></section>
            : null}
        {audienceSection(data)}
        {data.selected.channelIds.length > 0 && <section className="panel analytics-publishing">
          <div className="analytics-panel-title"><div><h2>Publishing records</h2><p className="small-note">Matched to selected channels and dates. Published posts use publish date, scheduled posts use scheduled date, and failed posts use creation date.</p></div></div>
          <div className="metric-grid"><article className="metric-card"><dl><dt>Published</dt><dd>{data.publishing.published}</dd></dl></article><article className="metric-card"><dl><dt>Scheduled</dt><dd>{data.publishing.scheduled}</dd></dl></article><article className="metric-card"><dl><dt>Failed or partial</dt><dd>{data.publishing.failed}</dd></dl></article></div>
        </section>}
        {data.selected.adAccountIds.length > 0 && <p className="small-note analytics-ad-coverage">{data.selected.adAccountIds.length} ad accounts selected. Coverage is shown for each metric.</p>}
        {data.detail ? <MetricTable data={data} /> : data.metrics.items.length ? <section className="panel">
          <div className="analytics-panel-title"><div><h2>Available metrics</h2><p className="small-note">Stored measurements for the selected resources and range. Use the sidebar to open a metric's full series and resource detail.</p></div><span className="badge">{data.metrics.total} metrics</span></div>
          <div className="analytics-metrics">{data.metrics.items.map(metric => <AnalyticsMetric key={`${metric.sourceLabel}:${metric.key}`} metric={metric} comparison={data.comparisons[metric.key]} chartPoints={data.chartPoints} />)}</div>
        </section> : data.selected.channelIds.length || data.selected.adAccountIds.length
          ? <section className="panel analytics-state"><h2>No metrics match these filters</h2><p>Change the date range, metric search, or resource selection in the sidebar.</p></section>
          : null}
      </>}
    </div>
  </PageFrame>;
}
