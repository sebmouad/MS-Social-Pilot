import { loadOverviewCopy } from '../../server/overview-copy';
import { workspaceText, workspaceCopyDefaults, type WorkspaceCopy } from '../../workspace-copy';
import { analyticsCopy } from '../../server/copy';
import { headers } from 'next/headers';
import { MetricViews } from './MetricViews';
import { loadChartAnnotations, type ChartAnnotations } from '@/modules/calendar-extras/server/chart-notes';
import { PageHeader } from '@/components/PageHeader';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readAnalyticsExplorer } from '@/modules/analytics/server/explorer';
import type { AnalyticsExplorerResult } from '@/modules/analytics/explorer';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { InsightsHeader } from '../insights/InsightsHeader';
import { resolvePeriod } from '../insights/period';
import { loadInsightsUi } from '../insights/runtime';
import { insightsReadInput, withParams } from '../insights/scope';
import { AddressSelect } from '../insights/AddressSelect';
import { ExploreSearchField } from './ExploreSearchField';
import styles from './explorer.module.css';

type Search = Record<string, string | string[] | undefined>;
function day(value: string) { return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)); }
function value(amount: number, unit: string) {
  const formatted = new Intl.NumberFormat('en', { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(amount);
  return unit === 'percent' ? `${formatted}%` : unit === 'multiple' ? `${formatted}×` : formatted;
}
function href(query: string, key: string, page: number) {
  const params = new URLSearchParams(query); params.set(key, String(page)); return `/insights/explore?${params.toString()}`;
}
function metricHref(query: string, metric: string) { const params = new URLSearchParams(query); params.set('metric', metric); params.delete('page'); params.set('pointPage', '1'); params.set('rowPage', '1'); return `/insights/explore?${params.toString()}`; }
function Pager({ t, query, keyName, page, pages, label }: { t: ReturnType<typeof workspaceText>; query: string; keyName: string; page: number; pages: number; label: string }) {
  if (pages < 2) return null;
  return <nav className={styles.pager} aria-label={t('{0} pages', label)}><span>{t("Page")}{" "}{page}{" "}{t("of")}{" "}{pages}</span>{page > 1 && <a href={href(query, keyName, page - 1)}>{t("Previous")}{" "}{label.toLowerCase()}</a>}{page < pages && <a href={href(query, keyName, page + 1)}>{t("Next")}{" "}{label.toLowerCase()}</a>}</nav>;
}
function Detail({ data, locale, copy, annotations }: { annotations?: ChartAnnotations | null; copy: WorkspaceCopy; data: AnalyticsExplorerResult; locale: 'en' | 'fr' }) {
  const t = workspaceText(copy, locale);
  const detail = data.detail!; const metric = detail.metric;
  return <section className={styles.panel} aria-labelledby="explorer-detail-title">
    <header className={styles.detailHeader}><div><p className={styles.eyebrow}>{t("Stored metric detail")}</p><h2 id="explorer-detail-title">{metric.label}</h2><p>{metric.sourceLabel} · {metric.aggregationLabel}</p>{metric.aggregationNote && <p>{metric.aggregationNote}</p>}</div><strong>{metric.displayTotal ?? (metric.total === null ? t('Unknown') : value(metric.total, metric.unit))}</strong></header>
    <p className={styles.coverage}>{t("Coverage:")}{" "}{metric.coverage}{" "}{t("of")}{" "}{metric.available}{" "}{t("selected resources. Missing measurements are unknown, not zero.")}</p>
    <MetricViews annotations={annotations} copy={copy} locale={locale} label={`${metric.label} · ${detail.points.total} points · UTC`} points={detail.points.items} unit={metric.unit} previousPoints={detail.previousPoints} />
    <Pager t={t} query={data.query} keyName="pointPage" page={detail.points.page} pages={detail.points.pages} label={t("Series")} />
    <div className={styles.tableWrap}><table><caption>{t("Resource values ·")}{" "}{detail.rows.total}{" "}{t("rows")}</caption><thead><tr><th scope="col">{metric.kind === 'breakdown' ? t('Dimension') : t('Resource')}</th><th scope="col">{t("Value")}</th><th scope="col">{t("As of")}</th></tr></thead><tbody>{detail.rows.items.map((row, index) => <tr key={`${row.label}:${index}`}><th scope="row">{row.label}</th><td>{value(row.value, metric.unit)}</td><td>{row.asOf ? day(row.asOf.toISOString().slice(0, 10)) : t('Date unavailable')}</td></tr>)}</tbody></table>{!detail.rows.total && <p className={styles.empty}>{t("No resource-level measurements are stored.")}</p>}</div>
    <Pager t={t} query={data.query} keyName="rowPage" page={detail.rows.page} pages={detail.rows.pages} label={t("Resources")} />
  </section>;
}

export default async function AnalyticsExplorerPage({ searchParams, locale = 'en' }: { searchParams: Promise<Search>; locale?: 'en' | 'fr' }) {
  const viewer = await requireViewer({ feature: 'analytics/explorer', channelScoped: true });
  const { workspace: copy } = await analyticsCopy();
  const overviewCopy = await loadOverviewCopy(locale);
  const t = workspaceText(copy, locale);
  const params = await searchParams; let data: AnalyticsExplorerResult | null = null; let failure = '';
  const runtime = await loadInsightsUi();
  const scope = await pageChannelScope(viewer, params);
  const period = resolvePeriod(params, runtime.policy);
  const input = insightsReadInput(params, scope.ids, { start: period.start, end: period.end, compare: period.compare });
  delete input.period;
  try { data = await readAnalyticsExplorer({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input,{ allowedChannelIds: viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, feature: 'analytics/explorer' }); }
  catch (error) { failure = operationFailure(error, t('Analytics Explorer could not be loaded. Change the filters or retry.')).error; }
  const annotations = data?.detail && data.selected.channelIds.length ? await loadChartAnnotations({ userId: viewer.user.id, workspaceId: viewer.workspaceId, locale }, data.period.start, data.period.end, data.selected.channelIds) : null;
  const exportParams = data ? new URLSearchParams(data.query) : null;
  if (exportParams) for (const key of ['source', 'kind', 'metric', 'page', 'pointPage', 'rowPage']) exportParams.delete(key);
  const exportHref = exportParams && canUseFeature(viewer.entitlements, 'analytics/reports') && canAccessFeature(viewer.permissions, 'analytics/reports') ? `/api/reports/export?${exportParams.toString()}` : undefined;
  // Every link below keeps the page's own address (channel scope, period, search), not the service's canonical form.
  const query = withParams(params, {});
  if (data) data = { ...data, query };
  const { copy: ui } = runtime;
  const search = data?.filters.search ?? '';
  const source = data?.filters.source ?? '';
  const kind = data?.filters.kind && data.filters.kind !== 'all' ? data.filters.kind : '';
  const kinds = [['flow', t('Period totals')], ['stock', t('Latest resource values')], ['ratio', t('Ratios')], ['breakdown', t('Category breakdowns')]] as const;
  const chips = [
    ...(search ? [{ key: 'search', label: ui.searchMetrics, value: search }] : []),
    ...(source ? [{ key: 'source', label: t('Source'), value: source }] : []),
    ...(kind ? [{ key: 'kind', label: t('Measurement type'), value: kinds.find(([value]) => value === kind)?.[1] ?? kind }] : []),
  ];
  return <PageFrame module="analytics" scopedAccess><div className="insights">
    <InsightsHeader runtime={runtime} title={ui.exploreTitle} info={ui.exploreInfo} period={period} chips={chips} activeCount={chips.length}
      actions={exportHref ? <a className="ui-button ui-button--secondary ui-button--md" href={exportHref}>{ui.downloadReport}</a> : undefined}
      filterBody={<>
        <ExploreSearchField label={ui.searchMetrics} placeholder={ui.searchMetricsPlaceholder} maxLength={data?.searchMaxCharacters} />
        <AddressSelect name="source" label={t('Source')} allLabel={t('All sources')} options={(data?.options.sources ?? []).map(item => ({ value: item, label: item }))} />
        <AddressSelect name="kind" label={t('Measurement type')} allLabel={t('All types')} options={kinds.map(([value, label]) => ({ value, label }))} />
      </>} />
    {failure && <section className={styles.panel} role="alert"><h2>{t("Explorer could not be loaded")}</h2><p>{failure}</p><a href="/insights/explore">{ui.resetFilters}</a></section>}
    {data && <div className="insights-explore" data-detail={data.detail ? 'true' : 'false'}>
      <nav className="insights-explore__list" aria-label={ui.exploreList}>
        <h2>{ui.exploreList} <small>{data.metrics.total}</small></h2>
        {data.metrics.items.length
          ? <ul>{data.metrics.items.map(metric => <li key={metric.key}>
            <a href={metricHref(query, metric.key)} aria-current={data.detail?.metric.key === metric.key ? 'true' : undefined}>
              <span className="insights-explore__dot" data-available={metric.coverage > 0} title={metric.coverage > 0 ? ui.exploreAvailable : ui.exploreUnavailable} />
              <span>{metric.label}<span className="insights-explore__source">{metric.sourceLabel}</span></span>
            </a></li>)}</ul>
          : <p className="small-note">{ui.exploreListEmpty}</p>}
        <Pager t={t} query={query} keyName="page" page={data.metrics.page} pages={data.metrics.pages} label={t("Metrics")} />
      </nav>
      <div className="insights-explore__detail">
        {data.detail ? <>
          <a className="insights-card__link" href={`/insights/explore?${withParams(params, { metric: null, pointPage: null, rowPage: null })}`}>← {ui.exploreBack}</a>
          <Detail annotations={annotations} copy={copy} data={data} locale={locale} />
        </> : <section className={styles.panel}><p>{ui.exploreChoose}</p></section>}
      </div>
    </div>}
  </div></PageFrame>;
}
