import { loadOverviewCopy } from '../server/overview-copy';
import { overviewCopyDefaults, overviewText, type OverviewCopy } from '../overview-copy';
import { AnalyticsFilters, MetricPicker } from './AnalyticsFilters';
import { EmptyState } from '@/components/EmptyState';
import { IconAlertTriangle, IconCalendarEvent, IconChartBar, IconPlugConnected, IconSend } from '@tabler/icons-react';
import { MetricCard } from '@/components/MetricCard';
import { OverviewInsights } from './insights/OverviewInsights';
import { PageHeader } from '@/components/PageHeader';
import { headers } from 'next/headers';
import { readChannelProfiles } from '@/modules/settings/channel-profiles/service';
import { profileChannelName, type ProfileDirectory } from '@/modules/settings/channel-profiles/contracts';
import { GroupShortcut } from '@/modules/settings/ui/profiles/GroupShortcut';
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

function formatDay(value: string, locale: string = 'en', options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatValue(value: number, unit: string, locale: string = 'en') {
  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(value);
  return unit === 'percent' ? `${amount}%` : unit === 'multiple' ? `${amount}×` : amount;
}

function Pagination({ query, parameter, page, pages, label, copy }: { copy: OverviewCopy; query: string; parameter: string; page: number; pages: number; label: string }) {
  const t = overviewText(copy);
  if (pages < 2) return null;
  return <nav className="analytics-pager" aria-label={t("{label} pages", { label })}>
    <span>{t("Page {page} of {pages}", { page, pages })}</span>
    {page > 1 && <a href={`/analytics?${updateQuery(query, parameter, page - 1)}`}>{t("Previous {label}", { label: label.toLowerCase() })}</a>}
    {page < pages && <a href={`/analytics?${updateQuery(query, parameter, page + 1)}`}>{t("Next {label}", { label: label.toLowerCase() })}</a>}
  </nav>;
}

function AnalyticsSidebar({ data, query, exportHref, connectionsHref, explorerHref, profiles, locale, copy }: { copy: OverviewCopy; profiles?: ProfileDirectory; locale: 'en' | 'fr'; data: AnalyticsReadResult; query: string; exportHref?: string; connectionsHref?: string; explorerHref?: string }) {
  const t = overviewText(copy);
  const params = new URLSearchParams(query);
  const selectedChannels = new Set(data.selected.channelIds);
  const selectedAccounts = new Set(data.selected.adAccountIds);
  const comparison = data.period.comparison?.mode ?? 'none';
  const selectedMetric = params.get('metric') ?? '';
  const freshPage = (name: string) => <input type="hidden" name={name} value="1" />;

  return <div className="analytics-sidebar">
    <form noValidate action="/analytics" method="get" className="analytics-sidebar-filter">
      <AnalyticsFilters copy={copy} title={t("Report filters")} query={query} path="/analytics" locale={locale}>
      <fieldset className="analytics-filter-section">
        <legend className="shell-subnav__label">{t("Stored calendar dates (UTC)")}</legend>
        <label className="analytics-date-filter">{t("From")}<input type="date" name="start" defaultValue={data.period.start} /></label>
        <label className="analytics-date-filter">{t("To")}<input type="date" name="end" defaultValue={data.period.end} /></label>
      </fieldset>
      <label className="analytics-select-filter">{t("Compare with")}
        <select name="compare" defaultValue={comparison}>
          <option value="none">{t("No comparison")}</option>
          <option value="previous">{t("Previous equal-length period")}</option>
          <option value="year">{t("Same calendar dates last year")}</option>
        </select>
      </label>
      <fieldset className="analytics-channel-group"><legend className="shell-subnav__label">{t("Channels")}</legend>
        {freshPage('filter')}
        {profiles && <GroupShortcut groups={profiles.groups} allowedIds={data.options.channels.map(channel => channel.id)} locale={locale} />}
        {data.options.channels.length ? data.options.channels.map(channel => <label key={channel.id}>
          <input type="checkbox" name="channel" value={channel.id} defaultChecked={selectedChannels.has(channel.id)} />
          <span>{profiles?.channels.find(profile => profile.id === channel.id) ? profileChannelName(profiles.channels.find(profile => profile.id === channel.id)!) : channel.name}</span>
        </label>) : <p className="small-note">{t("No channels available.")}</p>}
      </fieldset>
      <fieldset className="analytics-channel-group"><legend className="shell-subnav__label">{t("Ad accounts")}</legend>
        {freshPage('adFilter')}
        {data.options.adAccounts.length ? data.options.adAccounts.map(account => <label key={account.id}>
          <input type="checkbox" name="adAccount" value={account.id} defaultChecked={selectedAccounts.has(account.id)} />
          <span>{account.name}{account.currency ? ` · ${account.currency}` : ''}</span>
        </label>) : <p className="small-note">{t("No ad accounts available.")}</p>}
      </fieldset>
      <label className="analytics-select-filter">{t("Search metrics")}
        <input type="search" name="search" maxLength={data.searchMaxLength} defaultValue={params.get('search') ?? ''} placeholder={t("Name or source")} />
      </label>
      <MetricPicker copy={copy} locale={locale} label={t("Metric detail")} options={data.options.metrics} initial={selectedMetric} />
      {freshPage('page')}{freshPage('pointPage')}{freshPage('rowPage')}
      <Button type="submit" variant="primary">{t("Apply filters")}</Button>
      <a className="analytics-filter-reset" href="/analytics">{t("Reset filters")}</a>
    </AnalyticsFilters></form>

    <div className="analytics-sidebar-pages">
      <p className="shell-subnav__label">{t("Browse results")}</p>
      {!data.detail && <Pagination copy={copy} query={data.query} parameter="page" page={data.metrics.page} pages={data.metrics.pages} label={t("Metrics")} />}
      {data.detail && <>
        <Pagination copy={copy} query={data.query} parameter="pointPage" page={data.detail.points.page} pages={data.detail.points.pages} label={t("Series")} />
        <Pagination copy={copy} query={data.query} parameter="rowPage" page={data.detail.rows.page} pages={data.detail.rows.pages} label={t("Resources")} />
        <a className="analytics-sidebar-export" href={`/analytics?${removeQuery(data.query, 'metric')}`}>{t("Back to all metric cards")}</a>
      </>}
      {exportHref && <><a className="analytics-sidebar-export" href={exportHref}>{t("Export CSV")}</a><p className="analytics-export-note">{t("Exports include up to {limit} data rows. Larger downloads are marked as truncated.", { limit: data.exportRowLimit })}</p></>}
      {explorerHref && <a className="analytics-sidebar-export" href={explorerHref}>{t("Explore metric sources and types")}</a>}
      {connectionsHref && <a className="analytics-sidebar-export" href={connectionsHref}>{t("View connections")}</a>}
      {!data.metrics.total && <p className="small-note">{t("No metrics match these filters.")}</p>}
    </div>
  </div>;
}

function AnalyticsRecoverySidebar({ retryHref, copy }: { retryHref: string; copy: OverviewCopy }) {
  const t = overviewText(copy);
  return <div className="analytics-sidebar-pages">
    <p className="shell-subnav__label">{t("Recovery")}</p>
    <a href={retryHref}>{t("Try again with these filters")}</a>
    <a href="/analytics">{t("Reset filters")}</a>
  </div>;
}

function MetricTable({ data, copy, locale }: { data: AnalyticsReadResult; copy: OverviewCopy; locale: string }) {
  const t = overviewText(copy);
  const detail = data.detail!;
  const metric = detail.metric;
  const rowStart = detail.rows.total ? (detail.rows.page - 1) * detail.rows.pageSize + 1 : 0;
  const rowEnd = Math.min(detail.rows.page * detail.rows.pageSize, detail.rows.total);
  const pointStart = detail.points.total ? (detail.points.page - 1) * detail.points.pageSize + 1 : 0;
  const pointEnd = Math.min(detail.points.page * detail.points.pageSize, detail.points.total);
  const timeLabel = metric.resourceKind === 'ad-account' ? t("ad accounts") : t("channels");

  return <section className="panel analytics-detail" aria-labelledby="analytics-detail-title">
    <header className="analytics-panel-title"><div><p className="eyebrow">{t("Metric detail")}</p><h2 id="analytics-detail-title">{metric.label}</h2><p className="small-note">{metric.sourceLabel} · {metric.aggregationLabel}</p>{metric.aggregationNote && <p className="analytics-aggregation-note">{metric.aggregationNote}</p>}</div>
      <strong className="analytics-detail-total">{metric.displayTotal ?? (metric.total === null ? '—' : formatValue(metric.total, metric.unit, locale))}</strong>
    </header>
    <p className="analytics-detail-coverage">{t("Coverage: {covered} of {available} selected {resources}. A missing value is unknown, not zero.", { covered: metric.coverage, available: metric.available, resources: timeLabel })}</p>
    <AnalyticsMetricComparison locale={locale as 'en' | 'fr'} copy={copy} metric={metric} comparison={data.comparisons[metric.key]} />
    <div className="analytics-table-wrap" role="region" tabIndex={0} aria-label={t("Full date and value series · {total} stored values · showing {start}–{end}", { total: detail.points.total, start: pointStart, end: pointEnd })}>
      <table className="analytics-table">
        <caption>{t("Full date and value series · {total} stored values · showing {start}–{end}", { total: detail.points.total, start: pointStart, end: pointEnd })}</caption>
        <thead><tr><th scope="col">{t("Stored calendar date (UTC)")}</th><th scope="col">{t("Value")}</th></tr></thead>
        <tbody>{detail.points.items.map(point => <tr key={point.date}><th scope="row" title={t("Stored calendar date (UTC)")}>{formatDay(point.date, locale)}</th><td>{formatValue(point.value, metric.unit, locale)}</td></tr>)}</tbody>
      </table>
      {!detail.points.total && <p className="empty-note">{t("No dated values are stored for this metric.")}</p>}
    </div>
    <div className="analytics-table-wrap" role="region" tabIndex={0} aria-label={t("Resource detail · {total} stored rows · showing {start}–{end}", { total: detail.rows.total, start: rowStart, end: rowEnd })}>
      <table className="analytics-table">
        <caption>{t("Resource detail · {total} stored rows · showing {start}–{end}", { total: detail.rows.total, start: rowStart, end: rowEnd })}</caption>
        <thead><tr><th scope="col">{metric.kind === 'breakdown' ? t("Category") : metric.resourceKind === 'ad-account' ? t("Ad account") : t("Channel")}</th><th scope="col">{t("Value")}</th><th scope="col">{t("Data date")}</th></tr></thead>
        <tbody>{detail.rows.items.map(row => <tr key={`${row.label}:${row.asOf?.toISOString() ?? 'unknown'}`}><th scope="row">{row.label}</th><td>{formatValue(row.value, metric.unit, locale)}</td><td>{row.asOf ? formatDay(row.asOf.toISOString().slice(0, 10), locale) : t("Date unavailable")}</td></tr>)}</tbody>
      </table>
      {!detail.rows.total && <p className="empty-note">{t("No resource-level values are stored for this metric.")}</p>}
    </div>
  </section>;
}

function audienceSection(data: AnalyticsReadResult, copy: OverviewCopy, locale: string) {
  const t = overviewText(copy);
  if (!data.selected.channelIds.length) return null;
  return <section className="panel analytics-audience">
    <div className="analytics-panel-title"><div><h2>{t("Selected channel audience")}</h2><p className="small-note">{t("Latest stored audience count for each selected channel with a valid measure.")}</p></div><span className="badge">{t("{covered} of {selected} channels", { covered: data.audience.covered, selected: data.audience.selected })}</span></div>
    {data.audience.entries.length ? <>
      <div className="analytics-audience__total"><strong>{new Intl.NumberFormat(locale).format(data.audience.total)}</strong><span>{t("total audience across channels with data")}</span></div>
      <div className="report-list">{data.audience.entries.map(entry => <div className="report-row" key={entry.id}>
        <span>{entry.name}<small> {entry.metricLabel}</small></span>
        <strong>{t("{value} · data {date} · synced {synced}", { value: new Intl.NumberFormat(locale).format(entry.value), date: formatDay(entry.asOf.toISOString().slice(0, 10), locale), synced: formatDay(entry.fetchedAt.toISOString().slice(0, 10), locale) })}</strong>
      </div>)}</div>
    </> : <p className="empty-note">{t("No audience counts are stored for the selected channels. Missing audience data is unknown, not zero.")}</p>}
    <p className="small-note">{t("Counts are added across channels. People represented in more than one audience may be counted more than once.")}</p>
  </section>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/overview', channelScoped: true });
  const params = await searchParams;
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const copy = await loadOverviewCopy(locale);
  const t = overviewText(copy);
  const profiles = await readChannelProfiles({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'analytics/overview').catch(() => undefined);
  let data: AnalyticsReadResult | null = null;
  let failure: ReturnType<typeof operationFailure> | null = null;
  try {
    data = await readAnalytics({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, params as Record<string, unknown>, {
      allowedChannelIds: viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids,
      feature: 'analytics/overview',
    });
  } catch (error) {
    failure = operationFailure(error, t("Analytics could not be loaded. Try again or reset the filters."));
  }

  const canExport = data !== null && (data.selected.channelIds.length > 0 || data.selected.adAccountIds.length > 0)
    && canUseFeature(viewer.entitlements, 'analytics/reports') && canAccessFeature(viewer.permissions, 'analytics/reports');
  const canManageConnections = canUseFeature(viewer.entitlements, 'settings/connections') && canAccessFeature(viewer.permissions, 'settings/connections');
  const exportQuery = data ? new URLSearchParams(data.query) : null;
  if (data && exportQuery) {
    exportQuery.delete('page'); exportQuery.delete('pointPage'); exportQuery.delete('rowPage'); exportQuery.delete('metric');
  }
  const exportHref = canExport && exportQuery ? `/api/reports/export?${exportQuery.toString()}` : undefined;
  const explorerHref = data && canUseFeature(viewer.entitlements, 'analytics/explorer') && canAccessFeature(viewer.permissions, 'analytics/explorer') ? `/analytics/explorer?${exportQuery?.toString() ?? ''}` : undefined;
  const connectionsHref = canManageConnections ? '/settings/connections' : undefined;
  const retryQuery = rawQuery(params);
  const retryHref = `/analytics${retryQuery ? `?${retryQuery}` : ''}`;

  return <PageFrame module="analytics" scopedAccess sidebar={data ? <AnalyticsSidebar copy={copy} profiles={profiles} locale={locale} data={data} query={data.query} exportHref={exportHref} explorerHref={explorerHref} connectionsHref={!data.options.channels.length && !data.options.adAccounts.length ? connectionsHref : undefined} /> : failure ? <AnalyticsRecoverySidebar copy={copy} retryHref={retryHref} /> : undefined}>
    <div className="page-stack">
      <PageHeader module="analytics" title={t("Performance")} />
        {data && <><p title={t("These are inclusive stored calendar-date boundaries in UTC.")}>{t("Stored calendar dates (UTC): {start} to {end}.", { start: formatDay(data.period.start, locale), end: formatDay(data.period.end, locale) })}</p>
          {data.period.comparison && <p>{t("Compared with {period}: {start} to {end}.", { period: data.period.comparison.mode === "year" ? t("the same calendar dates last year") : t("the previous equal-length period"), start: formatDay(data.period.comparison.start, locale), end: formatDay(data.period.comparison.end, locale) })}</p>}
        </>}

      {failure && <section className="panel analytics-state"><EmptyState tone="error" title={t("Analytics could not be loaded")} action={<a href={retryHref}>{t("Try again with these filters")}</a>}>{failure.error} {t("Use the sidebar to retry with these filters or reset them.")}</EmptyState></section>}
      {data && <>
        {!data.options.channels.length && !data.options.adAccounts.length
          ? <section className="panel analytics-state"><EmptyState icon={<IconPlugConnected />} title={t("No selected resources are available")} action={connectionsHref ? <a href={connectionsHref}>{t("View connections")}</a> : undefined}>{t("Connect or enable a channel or ad account to see its stored metrics.")}</EmptyState></section>
          : (data.options.channels.length > 0 || data.options.adAccounts.length > 0) && !data.selected.channelIds.length && !data.selected.adAccountIds.length
            ? <section className="panel analytics-state"><EmptyState icon={<IconChartBar />} title={t("No resources selected")}>{t("Choose channels or ad accounts in the sidebar to see their stored metrics.")}</EmptyState></section>
            : null}
        {audienceSection(data, copy, locale)}
        {data.selected.channelIds.length > 0 && <OverviewInsights locale={locale} workspaceId={viewer.workspaceId} window={data.period.range}
          channels={data.options.channels.filter(channel => data!.selected.channelIds.includes(channel.id))} />}
        {data.selected.channelIds.length > 0 && <section className="panel analytics-publishing">
          <div className="analytics-panel-title"><div><h2>{t("Publishing records")}</h2><p className="small-note">{t("Matched to selected channels and dates. Published posts use publish date, scheduled posts use scheduled date, and failed posts use creation date.")}</p></div></div>
          <div className="metric-grid">
            <MetricCard module="analytics" icon={<IconSend />} label={t("Published")} value={data.publishing.published} />
            <MetricCard module="analytics" icon={<IconCalendarEvent />} label={t("Scheduled")} value={data.publishing.scheduled} />
            <MetricCard module="analytics" icon={<IconAlertTriangle />} label={t("Failed or partial")} value={data.publishing.failed} />
          </div>
        </section>}
        {data.selected.adAccountIds.length > 0 && <p className="small-note analytics-ad-coverage">{t("{count} ad accounts selected. Coverage is shown for each metric.", { count: data.selected.adAccountIds.length })}</p>}
        {data.detail ? <MetricTable copy={copy} locale={locale} data={data} /> : data.metrics.items.length ? <section className="panel">
          <div className="analytics-panel-title"><div><h2>{t("Available metrics")}</h2><p className="small-note">{t("Stored measurements for the selected resources and range. Use the sidebar to open a metric's full series and resource detail.")}</p></div><span className="badge">{t("{count} metrics", { count: data.metrics.total })}</span></div>
          <div className="analytics-metrics">{data.metrics.items.map(metric => <AnalyticsMetric copy={copy} key={`${metric.sourceLabel}:${metric.key}`} locale={locale} metric={metric} comparison={data.comparisons[metric.key]} previousPoints={data.previousPoints[metric.key]} chartPoints={data.chartPoints} />)}</div>
        </section> : data.selected.channelIds.length || data.selected.adAccountIds.length
          ? <EmptyState title={t("No metrics match these filters")} icon={<IconChartBar />} action={<a href="/analytics">{t("Reset filters")}</a>}>{t("Change the date range, metric search, or resource selection in the sidebar.")}</EmptyState>
          : null}
      </>}
    </div>
  </PageFrame>;
}
