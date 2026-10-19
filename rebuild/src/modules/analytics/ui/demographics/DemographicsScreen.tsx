import { Button } from '@/components/Button';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readDemographics } from '@/modules/analytics/demographics/server/demographics';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import type { DemographicMetric } from '@/modules/analytics/demographics/contracts';
import { WorkflowNav } from '@/modules/analytics/ui/reports/WorkflowNav';
import { formatDay, formatValue, formatWhen } from '@/modules/analytics/ui/reports/format';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';

type Search = Record<string, string | string[] | undefined>;
type Data = Awaited<ReturnType<typeof readDemographics>>;

function Rows({ rows, hidden, unit, caption }: { rows: DemographicMetric['rows']; hidden: number; unit: string; caption: string }) {
  const top = Math.max(1, ...rows.map(row => row.share ?? 0));
  return <div className={styles.tableWrap}><table><caption>{caption}</caption><thead><tr><th scope="col">Category</th><th scope="col" className={styles.num}>Value</th><th scope="col">Share</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={`${row.label}:${index}`}><th scope="row">{row.label}</th><td className={styles.num}>{formatValue(row.value, unit)}</td>
      <td>{row.share === null ? <span className={styles.note}>Not shown for this unit</span> : <><span>{row.share.toFixed(1)}%</span><span className={styles.barTrack} aria-hidden="true"><span className={styles.bar} style={{ width: `${Math.max(1, (row.share / top) * 100)}%` }} /></span></>}</td></tr>)}</tbody></table>
    {hidden > 0 && <p className={styles.note} style={{ padding: '.6rem .75rem' }}>{hidden} smaller categories are not shown.</p>}</div>;
}
function Metric({ metric }: { metric: DemographicMetric }) {
  return <div><h3>{metric.label}</h3><p>{metric.sourceLabel} · {metric.coverage} of {metric.available} selected channels reported · as of {formatWhen(metric.latestAt)}</p>
    <p>{metric.aggregationLabel}{metric.aggregationNote ? `. ${metric.aggregationNote}` : ''}</p>
    {metric.rows.length ? <Rows rows={metric.rows} hidden={metric.hiddenRows} unit={metric.unit} caption={`${metric.label} by category`} /> : <p className={styles.empty}>No categories are stored for this measure.</p>}</div>;
}
function values(value: string | string[] | undefined) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}
function Filters({ data, options, params, failure }: { data: Data | null; options: Awaited<ReturnType<typeof readAnalyticsSnapshot>> | null; params: Search; failure: string }) {
  const channels = data?.options.channels ?? options?.options.channels ?? [];
  const hasExplicitSelection = params.filter === '1' || params.channel !== undefined;
  const selected = new Set(hasExplicitSelection
    ? values(params.channel)
    : data?.selected.channelIds ?? options?.selected.channelIds ?? channels.map(channel => channel.id));
  const visibleIds = new Set(channels.map(channel => channel.id));
  const unavailableSelections = hasExplicitSelection ? values(params.channel).filter(id => !visibleIds.has(id)) : [];
  const start = params.start !== undefined ? first(params.start) : data?.period.start ?? options?.period.start ?? '';
  const end = params.end !== undefined ? first(params.end) : data?.period.end ?? options?.period.end ?? '';
  const dateField = (name: string, label: string, value: string) => {
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    return <label>{label}<input type={isDate || !value ? 'date' : 'text'} name={name} defaultValue={value} placeholder={isDate || !value ? undefined : 'YYYY-MM-DD'} maxLength={isDate || !value ? undefined : 10} inputMode={isDate || !value ? undefined : 'numeric'} aria-describedby={failure ? 'demographics-read-error' : undefined} /></label>;
  };
  return <form noValidate action="/analytics/demographics" method="get" className={styles.filters}>
    <fieldset><legend>Date range (UTC)</legend>{dateField('start', 'From', start)}{dateField('end', 'To', end)}</fieldset>
    <fieldset><legend>Channels</legend><input type="hidden" name="filter" value="1" />{channels.length ? channels.map(channel => <label className={styles.check} key={channel.id}><input type="checkbox" name="channel" value={channel.id} defaultChecked={selected.has(channel.id)} /><span>{channel.name}</span></label>) : <p className={styles.note}>No channels available.</p>}
      {unavailableSelections.map((id, index) => <label className={styles.check} key={`${id}:${index}`}><input type="checkbox" name="channel" value={id} defaultChecked /><span>Unavailable channel selection</span></label>)}</fieldset>
    <Button type="submit" variant="primary">Apply filters</Button><a href="/analytics/demographics">Reset filters</a></form>;
}

export default async function DemographicsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/demographics', channelScoped: true });
  const params = await searchParams; let data: Data | null = null; let failure = '';
  try { data = await readDemographics({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, params); }
  catch (error) { failure = operationFailure(error, 'Audience breakdowns could not be loaded. Change the filters or retry.').error; }
  let options: Awaited<ReturnType<typeof readAnalyticsSnapshot>> | null = null;
  if (!data) {
    try { options = await readAnalyticsSnapshot({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {}, { feature: 'analytics/demographics' }); }
    catch { /* Keep the correction form available even when scoped options cannot load. */ }
  }
  return <PageFrame module="analytics" scopedAccess sidebar={<WorkflowNav current="/analytics/demographics"><Filters data={data} options={options} params={params} failure={failure} /></WorkflowNav>}><div className={styles.root}>
    <header className={styles.heading}><p className={styles.eyebrow}>Analytics</p><h1>Audience breakdowns</h1><p>Who your selected channels reach, by country, city, age, gender and language, from stored measurements. Missing data is unknown, not zero.</p></header>
    {failure && <section id="demographics-read-error" className={styles.panel} role="alert"><h2>Breakdowns could not be loaded</h2><p>{failure}</p></section>}
    {data && <section className={styles.panel} aria-labelledby="aud-total"><h2 id="aud-total">Audience size</h2>
      <p><strong>{formatValue(data.audience.covered ? data.audience.total : null, 'count')}</strong> followers across {data.audience.covered} of {data.audience.selected} selected channels.</p><p>{data.audience.note}</p></section>}
    {data?.empty && <section className={styles.panel}><h2>No breakdowns yet</h2><p>No audience breakdowns are stored for the selected channels and dates. Try a wider range or other channels; breakdowns appear after the next analytics sync.</p></section>}
    {data?.groups.map(group => <section className={styles.panel} key={group.id} aria-labelledby={`g-${group.id}`}><h2 id={`g-${group.id}`}>{group.label}</h2>
      {group.combined && <div><h3>All sources combined</h3><p>{group.combined.sources} sources · {group.combined.coverage === null ? 'channel coverage unknown' : `${group.combined.coverage} channels`} · data from {formatDay(group.combined.oldestAsOf)} to {formatDay(group.combined.newestAsOf)}</p><p>{group.combined.note}</p>
        <Rows rows={group.combined.rows} hidden={group.combined.hiddenRows} unit="count" caption={`${group.label}, combined`} /></div>}
      {group.metrics.map(metric => <Metric key={metric.key} metric={metric} />)}</section>)}
    {!!data?.other.length && <section className={styles.panel}><h2>Other breakdowns</h2>{data.other.map(metric => <Metric key={metric.key} metric={metric} />)}</section>}
  </div></PageFrame>;
}
