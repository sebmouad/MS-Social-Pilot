import { BarChart } from '@/components/charts';
import { PageHeader } from '@/components/PageHeader';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readAnalyticsComparison } from '@/modules/analytics/comparison/server/comparison';
import { WorkflowNav } from '@/modules/analytics/ui/reports/WorkflowNav';
import { formatValue } from '@/modules/analytics/ui/reports/format';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import { comparisonInputFromSearch, comparisonSearchSchema } from './search';
import { ComparisonFilters } from './ComparisonFilters';

type Search = Record<string, string | string[] | undefined>;
const list = (value: string | string[] | undefined) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
const LABEL: Record<string, string> = { comparable: 'Compared', missing: 'Unknown on one side', coverage_changed: 'Different coverage', not_comparable: 'Not comparable' };

export default async function ComparePage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/compare', channelScoped: true });
  const rawParams = await searchParams; const parsed = comparisonSearchSchema.safeParse(rawParams); const params = parsed.success ? parsed.data : {};
  const input = parsed.success ? comparisonInputFromSearch(params) : null;
  let data: Awaited<ReturnType<typeof readAnalyticsComparison>> | null = null; let failure = '';
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  try {
    if (!parsed.success) throw new Error('Choose valid comparison filters and try again.');
    if (input) data = await readAnalyticsComparison(actor, input);
  }
  catch (error) { failure = operationFailure(error, 'The comparison could not be loaded. Change the choices or retry.').error; }
  // Channel choices come from a scoped read, so they never list channels the person cannot see.
  let channels: Array<{ id: string; name: string }> = data?.options.channels ?? [];
  if (!channels.length) { try { channels = (await (await import('@/modules/analytics/server/read')).readAnalyticsSnapshot(actor, {}, { feature: 'analytics/compare' })).options.channels; } catch { channels = []; } }
  const mode = first(params.mode) === 'channels' ? 'channels' : 'period';
  const form = <ComparisonFilters mode={mode} channels={channels} initial={{
    aStart: first(params.aStart), aEnd: first(params.aEnd), bStart: first(params.bStart), bEnd: first(params.bEnd),
    start: first(params.start), end: first(params.end), channel: list(params.channel), groupA: list(params.groupA), groupB: list(params.groupB),
  }} />;
  return <PageFrame module="analytics" scopedAccess sidebar={<WorkflowNav current="/analytics/compare">{form}</WorkflowNav>}><div className={styles.root}>
    <PageHeader module="analytics" title={"Compare periods or channels"} description={<>Differences are shown only where both sides measure the same thing with the same coverage. Reach and breakdowns are never subtracted, and missing data is unknown, not zero.</>} />
    {!input && !failure && <section className={styles.panel}><h2>Choose what to compare</h2><p>Pick two periods for the same channels, or two separate groups of channels in one period, then select Compare.</p></section>}
    {failure && <section className={styles.panel} role="alert"><h2>Comparison unavailable</h2><p>{failure}</p></section>}
    {data && <>
      <section className={styles.panel}><h2>Audience</h2><div className={styles.tiles}>
        {(['a', 'b'] as const).map(s => <div className={styles.tile} key={s}><span>{s === 'a' ? 'A' : 'B'}</span><strong>{formatValue(data.audience[s].total, 'count')}</strong><small>{data.audience[s].covered} of {data.audience[s].selected} channels reported</small></div>)}
        <div className={styles.tile}><span>Difference (A minus B)</span><strong>{data.audience.delta === null ? 'Unknown' : formatValue(data.audience.delta, 'count')}</strong><small>{data.audience.delta === null ? 'Shown only when every selected channel reported on both sides.' : 'Both sides fully covered.'}</small></div></div><p>{data.audience.note}</p></section>
      <section className={styles.panel}><h2>Metrics</h2>
        {data.metrics.filter(m => m.status === 'comparable').map(m => <BarChart key={m.key} label={`${m.label} · A / B`} categories={['A', 'B']}
          format={m.unit === 'percent' ? { style: 'percent' } : undefined}
          series={[{ id: m.key, name: m.label, values: [m.a?.total, m.b?.total].map(value => value == null ? null : m.unit === 'percent' ? value / 100 : value) }]} />)}
        {data.truncated && <p className={styles.alert} role="status">Showing {data.metrics.length} of {data.totalMetrics} metrics.</p>}
        {data.metrics.length ? <div className={styles.tableWrap}><table><caption>A is {data.mode === 'period' ? `${data.periods.a.start} to ${data.periods.a.end}` : 'group A'}; B is {data.mode === 'period' ? `${data.periods.b.start} to ${data.periods.b.end}` : 'group B'}</caption><thead><tr><th scope="col">Metric</th><th scope="col" className={styles.num}>A</th><th scope="col" className={styles.num}>B</th><th scope="col" className={styles.num}>Difference</th><th scope="col">Basis</th></tr></thead>
          <tbody>{data.metrics.map(m => <tr key={m.key}><th scope="row">{m.label}<br /><small>{m.sourceLabel}</small></th>
            <td className={styles.num}>{m.a ? formatValue(m.a.total, m.unit, m.a.displayTotal) : 'Unknown'}<br /><small>{m.a ? `${m.a.coverage}/${m.a.available} ${m.resourceKind === 'ad-account' ? 'ad accounts' : 'channels'}` : 'no data'}</small></td>
            <td className={styles.num}>{m.b ? formatValue(m.b.total, m.unit, m.b.displayTotal) : 'Unknown'}<br /><small>{m.b ? `${m.b.coverage}/${m.b.available} ${m.resourceKind === 'ad-account' ? 'ad accounts' : 'channels'}` : 'no data'}</small></td>
            <td className={styles.num}>{m.delta === null ? '–' : `${m.delta > 0 ? '+' : ''}${formatValue(m.delta, m.unit)}${m.percent === null ? '' : ` (${m.percent > 0 ? '+' : ''}${m.percent.toFixed(1)}%)`}`}</td>
            <td><strong>{LABEL[m.status]}</strong><br /><small>{m.reason}</small></td></tr>)}</tbody></table></div> : <p className={styles.empty}>No stored metrics exist for either side.</p>}</section></>}
  </div></PageFrame>;
}
