import { workspaceText, workspaceCopyDefaults, type WorkspaceCopy } from '../../workspace-copy';
import { analyticsCopy } from '../../server/copy';
import { headers } from 'next/headers';
import { BarChart } from '@/components/charts';
import { PageHeader } from '@/components/PageHeader';
import { InfoTip } from '@/components';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readAnalyticsComparison } from '@/modules/analytics/comparison/server/comparison';
import { formatValue as formatAnalyticsValue } from '@/modules/analytics/ui/reports/format';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import { comparisonInputFromSearch, comparisonSearchSchema } from './search';
import { ComparisonFilters } from './ComparisonFilters';
import { compareKindSwitch } from './compareKindSwitch';

type Search = Record<string, string | string[] | undefined>;
const list = (value: string | string[] | undefined) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
const LABEL: Record<string, string> = { comparable: 'Compared', missing: 'Unknown on one side', coverage_changed: 'Different coverage', not_comparable: 'Not comparable' };

export default async function ComparePage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/compare', channelScoped: true });
  const { workspace: copy } = await analyticsCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const t = workspaceText(copy, locale);
  const formatValue = (value: number | null | undefined, unit: string, displayTotal?: string) => formatAnalyticsValue(value, unit, displayTotal, locale, copy);
  const rawParams = await searchParams; const parsed = comparisonSearchSchema.safeParse(rawParams); const params = parsed.success ? parsed.data : {};
  const input = parsed.success ? comparisonInputFromSearch(params) : null;
  let data: Awaited<ReturnType<typeof readAnalyticsComparison>> | null = null; let failure = '';
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  try {
    if (!parsed.success) throw new Error(t('Choose valid comparison filters and try again.'));
    if (input) data = await readAnalyticsComparison(actor, input);
  }
  catch (error) { failure = operationFailure(error, t('The comparison could not be loaded. Change the choices or retry.')).error; }
  // Channel choices come from a scoped read, so they never list channels the person cannot see.
  let channels: Array<{ id: string; name: string }> = data?.options.channels ?? [];
  if (!channels.length) { try { channels = (await (await import('@/modules/analytics/server/read')).readAnalyticsSnapshot(actor, {}, { feature: 'analytics/compare' })).options.channels; } catch { channels = []; } }
  const kindSwitch = await compareKindSwitch('channels', viewer);
  const mode = first(params.mode) === 'channels' ? 'channels' : 'period';
  const form = <ComparisonFilters copy={copy} locale={locale} mode={mode} channels={channels} initial={{
    aStart: first(params.aStart), aEnd: first(params.aEnd), bStart: first(params.bStart), bEnd: first(params.bEnd),
    start: first(params.start), end: first(params.end), channel: list(params.channel), groupA: list(params.groupA), groupB: list(params.groupB),
  }} />;
  return <PageFrame module="analytics" scopedAccess><div className={styles.root}>
    <PageHeader module="analytics" title={t('Compare periods or channels')} info={<InfoTip name={t('Compare periods or channels')} blocks={[{ text: t("Differences are shown only where both sides measure the same thing with the same coverage. Reach and breakdowns are never subtracted, and missing data is unknown, not zero.") }]} />} actions={kindSwitch ?? undefined} />
    {form}
    {!input && !failure && <p className={styles.note}>{t("Pick two periods for the same channels, or two separate groups of channels in one period, then select Compare.")}</p>}
    {failure && <section className={styles.panel} role="alert"><h2>{t("Comparison unavailable")}</h2><p>{failure}</p></section>}
    {data && <>
      <section className={styles.panel}><h2>{t("Audience")}</h2><div className={styles.tiles}>
        {(['a', 'b'] as const).map(s => <div className={styles.tile} key={s}><span>{s === 'a' ? 'A' : 'B'}</span><strong>{formatValue(data.audience[s].total, 'count')}</strong><small>{data.audience[s].covered}{" "}{t("of")}{" "}{data.audience[s].selected}{" "}{t("channels reported")}</small></div>)}
        <div className={styles.tile}><span>{t("Difference (A minus B)")}</span><strong>{data.audience.delta === null ? t('Unknown') : formatValue(data.audience.delta, 'count')}</strong><small>{data.audience.delta === null ? t('Shown only when every selected channel reported on both sides.') : t('Both sides fully covered.')}</small></div></div><p>{data.audience.note}</p></section>
      <section className={styles.panel}><h2>{t("Metrics")}</h2>
        {data.metrics.filter(m => m.status === 'comparable').map(m => <BarChart key={m.key} label={`${m.label} · A / B`} categories={['A', 'B']}
          format={m.unit === 'percent' ? { style: 'percent' } : undefined}
          series={[{ id: m.key, name: m.label, values: [m.a?.total, m.b?.total].map(value => value == null ? null : m.unit === 'percent' ? value / 100 : value) }]} />)}
        {data.truncated && <p className={styles.alert} role="status">{t("Showing")}{" "}{data.metrics.length}{" "}{t("of")}{" "}{data.totalMetrics}{" "}{t("metrics.")}</p>}
        {data.metrics.length ? <div className={styles.tableWrap}><table><caption>{t("A is")}{" "}{data.mode === 'period' ? `${data.periods.a.start} to ${data.periods.a.end}` : t('group A')}{t("; B is")}{" "}{data.mode === 'period' ? `${data.periods.b.start} to ${data.periods.b.end}` : t('group B')}</caption><thead><tr><th scope="col">{t("Metric")}</th><th scope="col" className={styles.num}>{t("A")}</th><th scope="col" className={styles.num}>{t("B")}</th><th scope="col" className={styles.num}>{t("Difference")}</th><th scope="col">{t("Basis")}</th></tr></thead>
          <tbody>{data.metrics.map(m => <tr key={m.key}><th scope="row">{m.label}<br /><small>{m.sourceLabel}</small></th>
            <td className={styles.num}>{m.a ? formatValue(m.a.total, m.unit, m.a.displayTotal) : t('Unknown')}<br /><small>{m.a ? `${m.a.coverage}/${m.a.available} ${m.resourceKind === 'ad-account' ? t('ad accounts') : t('channels')}` : t('no data')}</small></td>
            <td className={styles.num}>{m.b ? formatValue(m.b.total, m.unit, m.b.displayTotal) : t('Unknown')}<br /><small>{m.b ? `${m.b.coverage}/${m.b.available} ${m.resourceKind === 'ad-account' ? t('ad accounts') : t('channels')}` : t('no data')}</small></td>
            <td className={styles.num}>{m.delta === null ? '–' : `${m.delta > 0 ? '+' : ''}${formatValue(m.delta, m.unit)}${m.percent === null ? '' : ` (${m.percent > 0 ? '+' : ''}${m.percent.toFixed(1)}%)`}`}</td>
            <td><strong>{t(LABEL[m.status] as keyof WorkspaceCopy)}</strong><br /><small>{m.reason}</small></td></tr>)}</tbody></table></div> : <p className={styles.empty}>{t("No stored metrics exist for either side.")}</p>}</section></>}
  </div></PageFrame>;
}
