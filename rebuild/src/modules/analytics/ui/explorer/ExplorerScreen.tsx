import { MetricViews } from './MetricViews';
import { PageHeader } from '@/components/PageHeader';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readAnalyticsExplorer } from '@/modules/analytics/server/explorer';
import type { AnalyticsExplorerResult } from '@/modules/analytics/explorer';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { ExplorerSidebar } from './sidebar';
import styles from './explorer.module.css';

type Search = Record<string, string | string[] | undefined>;
function day(value: string) { return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)); }
function value(amount: number, unit: string) {
  const formatted = new Intl.NumberFormat('en', { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(amount);
  return unit === 'percent' ? `${formatted}%` : unit === 'multiple' ? `${formatted}×` : formatted;
}
function href(query: string, key: string, page: number) {
  const params = new URLSearchParams(query); params.set(key, String(page)); return `/analytics/explorer?${params.toString()}`;
}
function metricHref(query: string, metric: string) { const params = new URLSearchParams(query); params.set('metric', metric); params.delete('page'); params.set('pointPage', '1'); params.set('rowPage', '1'); return `/analytics/explorer?${params.toString()}`; }
function Pager({ query, keyName, page, pages, label }: { query: string; keyName: string; page: number; pages: number; label: string }) {
  if (pages < 2) return null;
  return <nav className={styles.pager} aria-label={`${label} pages`}><span>Page {page} of {pages}</span>{page > 1 && <a href={href(query, keyName, page - 1)}>Previous {label.toLowerCase()}</a>}{page < pages && <a href={href(query, keyName, page + 1)}>Next {label.toLowerCase()}</a>}</nav>;
}
function Detail({ data, locale }: { data: AnalyticsExplorerResult; locale: 'en' | 'fr' }) {
  const detail = data.detail!; const metric = detail.metric;
  return <section className={styles.panel} aria-labelledby="explorer-detail-title">
    <header className={styles.detailHeader}><div><p className={styles.eyebrow}>Stored metric detail</p><h2 id="explorer-detail-title">{metric.label}</h2><p>{metric.sourceLabel} · {metric.aggregationLabel}</p>{metric.aggregationNote && <p>{metric.aggregationNote}</p>}</div><strong>{metric.displayTotal ?? (metric.total === null ? 'Unknown' : value(metric.total, metric.unit))}</strong></header>
    <p className={styles.coverage}>Coverage: {metric.coverage} of {metric.available} selected resources. Missing measurements are unknown, not zero.</p>
    <MetricViews locale={locale} label={`${metric.label} · ${detail.points.total} points · UTC`} points={detail.points.items} unit={metric.unit} previousPoints={detail.previousPoints} />
    <Pager query={data.query} keyName="pointPage" page={detail.points.page} pages={detail.points.pages} label="Series" />
    <div className={styles.tableWrap}><table><caption>Resource values · {detail.rows.total} rows</caption><thead><tr><th scope="col">{metric.kind === 'breakdown' ? 'Dimension' : 'Resource'}</th><th scope="col">Value</th><th scope="col">As of</th></tr></thead><tbody>{detail.rows.items.map((row, index) => <tr key={`${row.label}:${index}`}><th scope="row">{row.label}</th><td>{value(row.value, metric.unit)}</td><td>{row.asOf ? day(row.asOf.toISOString().slice(0, 10)) : 'Date unavailable'}</td></tr>)}</tbody></table>{!detail.rows.total && <p className={styles.empty}>No resource-level measurements are stored.</p>}</div>
    <Pager query={data.query} keyName="rowPage" page={detail.rows.page} pages={detail.rows.pages} label="Resources" />
  </section>;
}

export default async function AnalyticsExplorerPage({ searchParams, locale = 'en' }: { searchParams: Promise<Search>; locale?: 'en' | 'fr' }) {
  const viewer = await requireViewer({ feature: 'analytics/explorer', channelScoped: true });
  const params = await searchParams; let data: AnalyticsExplorerResult | null = null; let failure = '';
  try { data = await readAnalyticsExplorer({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, params as Record<string, unknown>, { allowedChannelIds: viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, feature: 'analytics/explorer' }); }
  catch (error) { failure = operationFailure(error, 'Analytics Explorer could not be loaded. Change the filters or retry.').error; }
  const exportParams = data ? new URLSearchParams(data.query) : null;
  if (exportParams) for (const key of ['source', 'kind', 'metric', 'page', 'pointPage', 'rowPage']) exportParams.delete(key);
  const exportHref = exportParams && canUseFeature(viewer.entitlements, 'analytics/reports') && canAccessFeature(viewer.permissions, 'analytics/reports') ? `/api/reports/export?${exportParams.toString()}` : undefined;
  const sidebar = data ? <ExplorerSidebar data={data} exportHref={exportHref} summaryHref={canUseFeature(viewer.entitlements, 'analytics/overview') && canAccessFeature(viewer.permissions, 'analytics/overview') ? '/analytics' : undefined} /> : <div className={styles.sidebar}><h2>Metric explorer</h2><a href="/analytics/explorer">Reset filters</a></div>;
  return <PageFrame module="analytics" scopedAccess sidebar={sidebar}><div className={styles.root}>
    <PageHeader module="analytics" title={"Metric explorer"} description={<>Explore stored measurements by resource, source and data type. The inclusive date range is {data ? `${day(data.period.start)} to ${day(data.period.end)} UTC` : 'unavailable'}.</>} />{data?.period.comparison && <p>Comparison range: {day(data.period.comparison.start)} to {day(data.period.comparison.end)}.</p>}
    {failure && <section className={styles.panel} role="alert"><h2>Explorer could not be loaded</h2><p>{failure}</p><p>Use the sidebar to adjust filters or reset them.</p></section>}
    {data?.detail ? <Detail data={data} locale={locale} /> : data && <section className={styles.panel}><header className={styles.listHeader}><div><h2>Available metrics</h2><p>{data.metrics.total} metrics match the current filters. Choose a metric for its complete stored date series and resource values.</p></div><span>{data.selected.channelIds.length} channels · {data.selected.adAccountIds.length} ad accounts</span></header>
      {data.metrics.items.length ? <div className={styles.metricList}>{data.metrics.items.map(metric => <article key={metric.key}><div><h3><a href={metricHref(data.query, metric.key)}>{metric.label}</a></h3><p>{metric.sourceLabel} · {metric.kind} · {metric.coverage}/{metric.available} resources</p><p>{metric.aggregationLabel}{metric.aggregationNote ? ` · ${metric.aggregationNote}` : ''}</p>{metric.latestAt && <small>Latest observation {day(metric.latestAt.toISOString().slice(0, 10))}</small>}</div><strong>{metric.displayTotal ?? (metric.total === null ? 'Unknown' : value(metric.total, metric.unit))}</strong></article>)}</div> : <p className={styles.empty}>No stored metrics match these filters. Try a wider date range, another source, or reset filters.</p>}
      <Pager query={data.query} keyName="page" page={data.metrics.page} pages={data.metrics.pages} label="Metrics" />
    </section>}
  </div></PageFrame>;
}
