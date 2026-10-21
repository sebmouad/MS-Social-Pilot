import type { OverviewCopy } from '../../overview-copy';
import { workspaceText, workspaceCopyDefaults, type WorkspaceCopy } from '../../workspace-copy';
import { AnalyticsFilters, MetricPicker } from '../AnalyticsFilters';
import { Button } from '@/components/Button';
import type { AnalyticsExplorerResult } from '@/modules/analytics/explorer';
import styles from './explorer.module.css';

export function ExplorerSidebar({ data, exportHref, summaryHref, copy = workspaceCopyDefaults, locale = 'en', overviewCopy }: { overviewCopy?: OverviewCopy; copy?: WorkspaceCopy; locale?: 'en' | 'fr'; data: AnalyticsExplorerResult; exportHref?: string; summaryHref?: string }) {
  const t = workspaceText(copy, locale);
  const params = new URLSearchParams(data.query);
  const channels = new Set(data.selected.channelIds);
  return <div className={styles.sidebar}>
    {summaryHref && <a href={summaryHref}>{t("Analytics summary")}</a>}
    <form noValidate action="/analytics/explorer" method="get" className={styles.filters}>
      <AnalyticsFilters copy={overviewCopy} locale={locale} title={t("Explore stored metrics")} path="/analytics/explorer" query={data.query}>
      <fieldset><legend>{t("Date range (UTC)")}</legend><label>{t("From")}<input type="date" name="start" defaultValue={data.period.start} /></label><label>{t("To")}<input type="date" name="end" defaultValue={data.period.end} /></label></fieldset>
      <label>{t("Compare with")}<select name="compare" defaultValue={params.get('compare') ?? 'none'}><option value="none">{t("No comparison")}</option><option value="previous">{t("Previous equal-length period")}</option><option value="year">{t("Same dates last year")}</option></select></label>
      <fieldset><legend>{t("Channels")}</legend><input type="hidden" name="filter" value="1" />{data.options.channels.length ? data.options.channels.map(channel => <label className={styles.check} key={channel.id}><input type="checkbox" name="channel" value={channel.id} defaultChecked={channels.has(channel.id)} /><span>{channel.name}</span></label>) : <p>{t("No available channels.")}</p>}</fieldset>
      <label>{t("Search metrics")}<input type="search" name="search" maxLength={data.searchMaxCharacters} defaultValue={data.filters.search} placeholder={t("Metric name or source")} /></label>
      <label>{t("Source")}<select name="source" defaultValue={data.filters.source}><option value="">{t("All sources")}</option>{data.options.sources.map(source => <option key={source} value={source}>{source}</option>)}</select></label>
      <label>{t("Measurement type")}<select name="kind" defaultValue={data.filters.kind}><option value="all">{t("All types")}</option><option value="flow">{t("Period totals")}</option><option value="stock">{t("Latest resource values")}</option><option value="ratio">{t("Ratios")}</option><option value="breakdown">{t("Category breakdowns")}</option></select></label>
      <MetricPicker copy={overviewCopy} locale={locale} label={t("Open metric")} options={data.options.metrics} initial={params.get('metric') ?? ''} />
      {params.get('metric') && <><input type="hidden" name="pointPage" value="1" /><input type="hidden" name="rowPage" value="1" /></>}
      <Button type="submit" variant="primary">{t("Apply filters")}</Button><a href="/analytics/explorer">{t("Reset filters")}</a>
    </AnalyticsFilters></form>
    {exportHref && <div className={styles.export}><a href={exportHref}>{t("Export selected date range as CSV")}</a><p>{t("This uses your Analytics export access and the current export limits.")}</p></div>}
    <p className={styles.sidebarNote}>{t("Explorer reads stored results only. It does not start provider syncs. Missing values are unknown, not zero.")}</p>
  </div>;
}
