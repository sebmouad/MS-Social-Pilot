import { analyticsCopy } from '../../server/copy';
import { BarChart } from '@/components/charts';
import { PageHeader } from '@/components/PageHeader';
import { headers } from 'next/headers';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { IconUsers } from '@tabler/icons-react';
import { AudienceChart } from './AudienceCharts';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readDemographics } from '@/modules/analytics/demographics/server/demographics';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { insightsReadInput } from '@/modules/analytics/ui/insights/scope';
import { WorkflowNav } from '@/modules/analytics/ui/reports/WorkflowNav';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';

type Search = Record<string, string | string[] | undefined>;
const first = (v: Search[string]) => Array.isArray(v) ? v[0] ?? '' : v ?? '';
const values = (v: Search[string]) => v === undefined ? [] : Array.isArray(v) ? v : [v];

export default async function DemographicsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/demographics', channelScoped: true });
  const fr = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '');
  const { demographics: copy } = await analyticsCopy();
  const t = (key: keyof typeof copy) => copy[key][fr ? 'fr' : 'en'];
  const number = new Intl.NumberFormat(fr ? 'fr' : 'en', { maximumFractionDigits: 1 });
  const unknown = t("Not available");
  const when = (date: Date | null) => date ? date.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : unknown;
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof readDemographics>> | null = null;
  let options: Awaited<ReturnType<typeof readAnalyticsSnapshot>> | null = null;
  let failed = false;
  // The sidebar's channel list scopes the page; the page keeps only its date range.
  const scope = await pageChannelScope(viewer, params);
  try { data = await readDemographics({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, insightsReadInput(params, scope.ids)); }
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
    return <label className="ui-field">{label}<input className="ui-input" type={!value || valid ? 'date' : 'text'} name={name} defaultValue={value} aria-describedby={failed ? 'demographics-error' : undefined} /></label>;
  };
  const filters = <form noValidate action="/insights/audience" className={styles.filters}>
    <fieldset><legend>{t("Date range (UTC)")}</legend>{dateField('start', t("From"))}{dateField('end', t("To"))}</fieldset>
    {scope.ids.length ? <input type="hidden" name="channel" value={scope.ids.join(',')} /> : null}
    {!channels.length && <p>{t("No channels available.")}</p>}
    <Button type="submit" variant="primary">{t("Apply filters")}</Button>
    <a href="/insights/audience">{t("Reset filters")}</a>
    {data && <a href={`/api/analytics/demographics?${query}`} download>{t("Export full history (CSV)")}</a>}
  </form>;
  const metrics = data ? [...data.groups.flatMap(group => group.metrics), ...data.other] : [];
  return <PageFrame module="analytics" scopedAccess><div className={styles.root}>
    <WorkflowNav current="/insights/audience">{filters}</WorkflowNav>
    <PageHeader module="analytics" title={t("Audience history")} description={<>{t("Stored age, gender, country, city and language categories, as supplied by the provider. Each snapshot stands alone; counts are never added across dates or sources.")}</>} />
      {data && <p>{data.period.start} — {data.period.end} UTC</p>}
    {failed && <section id="demographics-error" className={styles.panel}><EmptyState tone="error" title={t("History could not be loaded")} action={<a href="/insights/audience">{t("Reset filters")}</a>}>{t("Review your dates and channels, narrow the period, or retry. Your filters have been retained.")}</EmptyState></section>}
    {data && <section className={styles.panel}><h2>{t("Audience size")}</h2><p>{data.audience.covered ? number.format(data.audience.total) : unknown} · {data.audience.covered} / {data.audience.selected} {t("selected channels")}</p><p>{t("Latest valid figure per covered channel. This is not a count of unique people across networks.")}</p></section>}
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
