import { readPageBenchmark } from '@/modules/analytics/compare/page-benchmark';
import { workspaceText, workspaceCopyDefaults, type WorkspaceCopy } from '../../workspace-copy';
import { analyticsCopy } from '../../server/copy';
import { headers } from 'next/headers';
import { PageHeader } from '@/components/PageHeader';
import { InfoTip } from '@/components';
import { Sparkline } from '@/components/Sparkline';
import { DeltaBadge } from '@/components/DeltaBadge';
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
const DAY_MS = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function defaultComparePeriods(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const aEnd = isoDay(today);
  const aStart = isoDay(new Date(today.getTime() - 27 * DAY_MS));
  const bEnd = isoDay(new Date(today.getTime() - 28 * DAY_MS));
  const bStart = isoDay(new Date(today.getTime() - 55 * DAY_MS));
  return { aStart, aEnd, bStart, bEnd, start: aStart, end: aEnd };
}

const BENCHMARK_COPY = {
  en: { title: 'Page benchmark', channel: 'Channel', followers: 'Followers', postsPerWeek: 'Posts / week',
    average: (label: string | null) => `Average per post${label ? ` (${label})` : ''}`, measured: (n: number) => `${n} measured posts`,
    note: (days: number, label: string | null) => `Your selected channels over the last ${days} days, best average first${label ? `, ranked by ${label}` : ''}. Stored data only; unknown values are not zero.`,
    truncated: 'Some posts were left out because the period holds more posts than one read allows.' },
  fr: { title: 'Comparatif des pages', channel: 'Canal', followers: 'Abonnés', postsPerWeek: 'Publications / semaine',
    average: (label: string | null) => `Moyenne par publication${label ? ` (${label})` : ''}`, measured: (n: number) => `${n} publications mesurées`,
    note: (days: number, label: string | null) => `Vos canaux sélectionnés sur les ${days} derniers jours, meilleure moyenne en premier${label ? `, classés par ${label}` : ''}. Données enregistrées uniquement ; une valeur inconnue n’est pas zéro.`,
    truncated: 'Certaines publications ont été omises : la période en contient plus qu’une lecture ne le permet.' },
} as const;

export default async function ComparePage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/compare', channelScoped: true });
  const { workspace: copy } = await analyticsCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const t = workspaceText(copy, locale);
  const formatValue = (value: number | null | undefined, unit: string, displayTotal?: string) => formatAnalyticsValue(value, unit, displayTotal, locale, copy);
  const rawParams = await searchParams;
  const parsed = comparisonSearchSchema.safeParse(rawParams);
  const defaults = defaultComparePeriods();
  const rawData = parsed.success ? parsed.data : {};
  const hasExplicitModeOrDates = Boolean(rawData.mode || rawData.aStart || rawData.aEnd || rawData.bStart || rawData.bEnd || rawData.start || rawData.end);
  const params = parsed.success && !hasExplicitModeOrDates
    ? { mode: 'period' as const, ...defaults, ...rawData }
    : rawData;
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
  // Your own channels side by side over the last weeks, from stored data (competitor Pages need Meta's public content access).
  const benchmark = await readPageBenchmark({ ...actor, ...(viewer.permissions.pageScope.all ? {} : { allowedChannelIds: viewer.permissions.pageScope.ids }) });
  const integer = new Intl.NumberFormat(locale), decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const bench = BENCHMARK_COPY[locale];
  const mode = first(params.mode) === 'channels' ? 'channels' : 'period';
  const form = <ComparisonFilters copy={copy} locale={locale} mode={mode} channels={channels} initial={{
    aStart: first(params.aStart), aEnd: first(params.aEnd), bStart: first(params.bStart), bEnd: first(params.bEnd),
    start: first(params.start), end: first(params.end), channel: list(params.channel), groupA: list(params.groupA), groupB: list(params.groupB),
  }} />;
  const basis = data && (data.mode === 'period'
    ? `A ${data.periods.a.start} – ${data.periods.a.end} · B ${data.periods.b.start} – ${data.periods.b.end} · ${data.selected.a.channelIds.length} ${t('channels')}`
    : `${t('Group A')}: ${data.selected.a.channelIds.length} · ${t('Group B')}: ${data.selected.b.channelIds.length} · ${data.periods.a.start} – ${data.periods.a.end}`);
  return <PageFrame module="analytics" scopedAccess><div className={styles.root}>
    <PageHeader module="analytics" title={t('Compare periods or channels')} description={basis ?? undefined} info={<InfoTip name={t('Compare periods or channels')} blocks={[{ text: t("Differences are shown only where both sides measure the same thing with the same coverage. Reach and breakdowns are never subtracted, and missing data is unknown, not zero.") }]} />} actions={kindSwitch ?? undefined} />
    {form}
    {!input && !failure && <p className={styles.note}>{t("Pick two periods for the same channels, or two separate groups of channels in one period, then select Compare.")}</p>}
    {failure && <section className={styles.panel} role="alert"><h2>{t("Comparison unavailable")}</h2><p>{failure}</p></section>}
    {data && <>
      <section className={styles.panel}><h2>{t("Audience")}</h2><div className={styles.tiles}>
        {(['a', 'b'] as const).map(s => <div className={styles.tile} key={s}><span>{s === 'a' ? 'A' : 'B'}</span><strong>{formatValue(data.audience[s].total, 'count')}</strong><small>{data.audience[s].covered}{" "}{t("of")}{" "}{data.audience[s].selected}{" "}{t("channels reported")}</small></div>)}
        <div className={styles.tile}><span>{t("Difference (A minus B)")}</span><strong>{data.audience.delta === null ? t('Unknown') : formatValue(data.audience.delta, 'count')}</strong><small>{data.audience.delta === null ? t('Shown only when every selected channel reported on both sides.') : t('Both sides fully covered.')}</small></div></div><p>{data.audience.note}</p></section>
      <section className={styles.panel}><h2>{t("Metrics")}</h2>
        {/* The table below states A, B and the difference for every metric; a two-bar chart per metric only repeated it. */}
        {data.truncated && <p className={styles.alert} role="status">{t("Showing")}{" "}{data.metrics.length}{" "}{t("of")}{" "}{data.totalMetrics}{" "}{t("metrics.")}</p>}
        {data.metrics.length ? <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={t("Metrics")}><table><caption>{t("A is")}{" "}{data.mode === 'period' ? `${data.periods.a.start} to ${data.periods.a.end}` : t('group A')}{t("; B is")}{" "}{data.mode === 'period' ? `${data.periods.b.start} to ${data.periods.b.end}` : t('group B')}</caption><thead><tr><th scope="col">{t("Metric")}</th><th scope="col" className={styles.num}>{t("A")}</th><th scope="col" className={styles.num}>{t("B")}</th><th scope="col" className={styles.num}>{t("Difference")}</th><th scope="col">{t("Basis")}</th></tr></thead>
          <tbody>{data.metrics.map(m => <tr key={m.key}><th scope="row">{m.label}<br /><small>{m.sourceLabel}</small></th>
            <td className={styles.num}>{m.a ? formatValue(m.a.total, m.unit, m.a.displayTotal) : t('Unknown')}<br /><small>{m.a ? `${m.a.coverage}/${m.a.available} ${m.resourceKind === 'ad-account' ? t('ad accounts') : t('channels')}` : t('no data')}</small></td>
            <td className={styles.num}>{m.b ? formatValue(m.b.total, m.unit, m.b.displayTotal) : t('Unknown')}<br /><small>{m.b ? `${m.b.coverage}/${m.b.available} ${m.resourceKind === 'ad-account' ? t('ad accounts') : t('channels')}` : t('no data')}</small></td>
            <td className={styles.num}>{m.delta === null ? '–' : `${m.delta > 0 ? '+' : ''}${formatValue(m.delta, m.unit)}${m.percent === null ? '' : ` (${m.percent > 0 ? '+' : ''}${m.percent.toFixed(1)}%)`}`}</td>
            <td><strong>{t(LABEL[m.status] as keyof WorkspaceCopy)}</strong><br /><small>{m.reason}</small></td></tr>)}</tbody></table></div> : <p className={styles.empty}>{t("No stored metrics exist for either side.")}</p>}</section></>}
    {benchmark && benchmark.rows.length > 1 ? <section className={styles.panel} aria-labelledby="page-benchmark">
      <h2 id="page-benchmark">{bench.title}</h2>
      <p className={styles.note}>{bench.note(benchmark.days, benchmark.rankLabel)}</p>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-labelledby="page-benchmark"><table>
        <thead><tr><th scope="col">{bench.channel}</th><th scope="col" className={styles.num}>{bench.followers}</th><th scope="col" className={styles.num}>{bench.postsPerWeek}</th><th scope="col" className={styles.num}>{bench.average(benchmark.rankLabel)}</th></tr></thead>
        <tbody>{benchmark.rows.map(row => <tr key={row.id}>
          <th scope="row">{row.name}</th>
          <td className={styles.num}>{row.followers === null ? t('Unknown') : integer.format(row.followers)}</td>
          <td className={styles.num}>{decimal.format(row.postsPerWeek)}</td>
          <td className={styles.num}>{row.avgRank === null ? t('Unknown') : decimal.format(row.avgRank)}<br /><small>{bench.measured(row.measuredPosts)}</small></td>
        </tr>)}</tbody>
      </table></div>
      {benchmark.truncated ? <p className={styles.note}>{bench.truncated}</p> : null}
    </section> : null}
  </div></PageFrame>;
}
