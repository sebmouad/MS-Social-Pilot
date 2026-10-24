import { analyticsCopy } from '../../server/copy';
import { BarChart } from '@/components/charts';
import { PageHeader } from '@/components/PageHeader';
import { headers } from 'next/headers';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { IconDownload, IconUsers } from '@tabler/icons-react';
import { InfoTip } from '@/components';
import { AudienceChart } from './AudienceCharts';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readDemographics } from '@/modules/analytics/demographics/server/demographics';
import { demographicsCopyDefaults } from '@/modules/analytics/demographics/copy';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { insightsReadInput } from '@/modules/analytics/ui/insights/scope';
import { InsightsFilterRow } from '@/modules/analytics/ui/insights/InsightsFilterRow';
import { insightsCopyDefaults, insightsPolicyDefaults, resolveInsightsCopy } from '@/modules/analytics/ui/insights/insights-config';
import { presetRange, resolvePeriod } from '@/modules/analytics/ui/insights/period';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';

type Search = Record<string, string | string[] | undefined>;
const first = (v: Search[string]) => Array.isArray(v) ? v[0] ?? '' : v ?? '';
const values = (v: Search[string]) => v === undefined ? [] : Array.isArray(v) ? v : [v];

export default async function DemographicsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/demographics', channelScoped: true });
  const fr = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '');
  const locale = fr ? 'fr' : 'en';
  const { demographics: copy } = await analyticsCopy();
  const t = (key: keyof typeof copy) => copy[key][locale];
  // Saved catalogs predate the truncation notice; fall back to the shipped default until Root re-saves.
  const notice = (key: 'Showing the latest' | 'of' | 'stored snapshots. Narrow the dates or channels to see older ones.') =>
    (copy as Record<string, { en: string; fr: string } | undefined>)[key]?.[locale] ?? demographicsCopyDefaults[key][locale];
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const unknown = t("Not available");
  const when = (date: Date | null) => date ? date.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : unknown;
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof readDemographics>> | null = null;
  let options: Awaited<ReturnType<typeof readAnalyticsSnapshot>> | null = null;
  let failed = false;
  // The sidebar's channel list scopes the page; the page keeps only its date range.
  const scope = await pageChannelScope(viewer, params);
  const presetPeriod = first(params.period) ? resolvePeriod(params, insightsPolicyDefaults) : null;
  const readInput = insightsReadInput(params, scope.ids, presetPeriod ? { start: presetPeriod.start, end: presetPeriod.end } : {});
  delete readInput.period;
  try { data = await readDemographics({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, readInput); }
  catch { failed = true; }
  if (!data) {
    try { options = await readAnalyticsSnapshot({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {}, { feature: 'analytics/demographics' }); }
    catch { /* Preserve the correction form. */ }
  }
  const channels = data?.options.channels ?? options?.options.channels ?? [];
  const query = new URLSearchParams();
  if (data) {
    query.set('start', data.period.start); query.set('end', data.period.end); query.set('filter', '1');
    data.selected.channelIds.forEach(id => query.append('channel', id)); query.set('format', 'csv');
  }
  const dateField = (name: 'start' | 'end', label: string) => {
    const value = params[name] !== undefined ? first(params[name]) : data?.period[name] ?? options?.period[name] ?? '';
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    return <label className={styles.inlineField}><span>{label}</span><input className="ui-input" type={!value || valid ? 'date' : 'text'} name={name} defaultValue={value} aria-describedby={failed ? 'demographics-error' : undefined} /></label>;
  };
  const now = new Date();
  const presets = insightsPolicyDefaults.rangePresets.map(item => ({ id: item.id, label: item.label[locale], ...presetRange(item, now) }));
  const activeStart = first(params.start) || data?.period.start || options?.period.start || '';
  const activeEnd = first(params.end) || data?.period.end || options?.period.end || '';
  const matchedPreset = presets.find(item => item.id === first(params.period)) ?? presets.find(item => item.start === activeStart && item.end === activeEnd);
  const periodValue = { preset: matchedPreset?.id ?? (activeStart && activeEnd ? 'custom' : insightsPolicyDefaults.defaultPreset), start: activeStart, end: activeEnd };
  const ui = resolveInsightsCopy(insightsCopyDefaults as never, locale);
  // One compact toolbar on the title row: the period picker and CSV export (or the inline recovery form after an invalid date).
  const filters = failed ? <form noValidate action="/insights/audience" className={styles.toolbar} aria-label={t("Date range (UTC)")}>
    {dateField('start', t("From"))}{dateField('end', t("To"))}
    {scope.ids.length ? <input type="hidden" name="channel" value={scope.ids.join(',')} /> : null}
    <Button type="submit" variant="secondary" size="sm">{t("Apply filters")}</Button>
  </form> : <div className={styles.toolbar}>
    <InsightsFilterRow presets={presets} period={periodValue} compare={false} showCompare={false} writePresetDates
      labels={{ period: ui.datePeriod, compare: ui.compareToggle, active: ui.activeFilters, remove: ui.removeFilter, reset: ui.resetFilters, filters: t("Date range (UTC)"), customSummary: t("Date range (UTC)") }} />
    {data && <a className="ui-button ui-button--quiet ui-button--sm" href={`/api/analytics/demographics?${query}`} download><IconDownload size={16} aria-hidden="true" />{t("Export full history (CSV)")}</a>}
  </div>;
  const metrics = data ? [...data.groups.flatMap(group => group.metrics), ...data.other] : [];
  return <PageFrame module="analytics" scopedAccess><div className={styles.root}>
    <PageHeader module="analytics" title={t("Audience history")} info={<InfoTip name={t("Audience history")} blocks={[{ text: t("Stored age, gender, country, city and language categories, as supplied by the provider. Each snapshot stands alone; counts are never added across dates or sources.") }]} />} filters={filters} />
    {!channels.length && <p className={styles.note}>{t("No channels available.")}</p>}
    {failed && <section id="demographics-error" className={styles.panel}><EmptyState tone="error" title={t("History could not be loaded")} action={<a href="/insights/audience">{t("Reset filters")}</a>}>{t("Review your dates and channels, narrow the period, or retry. Your filters have been retained.")}</EmptyState></section>}
    {data && <section className={styles.panel}><h2>{t("Audience size")}</h2><p>{data.audience.covered ? number.format(data.audience.total) : unknown} · {data.audience.covered} / {data.audience.selected} {t("selected channels")}</p><p>{t("Latest valid figure per covered channel. This is not a count of unique people across networks.")}</p></section>}
    {data?.historyTruncated && <p className={styles.note} role="status">{notice("Showing the latest")} {number.format(data.historyShownSnapshots)} {notice("of")} {number.format(data.historyTotalSnapshots)} {notice("stored snapshots. Narrow the dates or channels to see older ones.")}</p>}
    {data?.empty && <section className={styles.panel}><EmptyState icon={<IconUsers />} title={t("No stored breakdowns")} action={<a href="/insights/audience">{t("Reset filters")}</a>}>{t("Not available for these channels and dates. Try another period or channel.")}</EmptyState></section>}
    {metrics.map(metric => <section key={metric.key} className={styles.panel}><h2>{metric.label}</h2><p>{metric.sourceLabel} · {metric.unit}</p>
      <p>{t("Channels with stored snapshots")} : {metric.historyCoverage.covered} / {metric.historyCoverage.selected} · {when(metric.historyCoverage.oldestAsOf)} — {when(metric.historyCoverage.newestAsOf)}</p>
      <AudienceChart copy={copy} locale={fr ? 'fr' : 'en'} label={`${metric.label} · ${t("latest stored figures")}`} rows={metric.rows} />
      {!metric.history.length && <p>{unknown}</p>}
      {metric.history.map(item => <details key={`${item.resourceId}:${item.asOf.toISOString()}`}><summary>{item.resourceLabel} · {t("As of")} {when(item.asOf)}</summary>
        <p>{t("Fetched at")} {when(item.fetchedAt)}</p>
        <BarChart locale={fr ? 'fr' : 'en'} label={`${metric.label} · ${item.resourceLabel} · ${when(item.asOf)}`} orientation="horizontal"
          categories={item.rows.map(row => row.label)} series={[{ id: metric.key, name: metric.label, values: item.rows.map(row => row.value) }]} />
        <div className={styles.tableWrap}><table><caption>{metric.label} · {item.resourceLabel} · {when(item.asOf)}</caption><thead><tr><th scope="col">{t("Category")}</th><th scope="col">{t("Value")}</th><th scope="col">{t("Share of snapshot")}</th></tr></thead><tbody>
          {item.rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.value === null ? unknown : number.format(row.value)}</td><td>{row.share === null ? unknown : `${number.format(row.share)}%`}</td></tr>)}
        </tbody></table></div></details>)}
    </section>)}
  </div></PageFrame>;
}
