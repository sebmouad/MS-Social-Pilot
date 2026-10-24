import { localizeAdsMessage } from '@/modules/ads/copy';
import { loadAdsCopy } from '@/modules/ads/server/copy';
import { customerText } from '@/modules/ads/copy';
import { AdsCopyProvider } from '@/modules/ads/ui/AdsCopyProvider';
import { TimeSeriesChart } from '@/components/charts';
import { PageHeader } from '@/components/PageHeader';
import '@/modules/ads/ui/ads.css';
import '@/modules/ads/ui/objects/objects.css';
import { ObjectPerformance } from './ObjectPerformance';
import { ComparisonExport } from './ComparisonExport';
import { loadAdsOutputPolicy } from '../../server/output-policy';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { entitledPlatformIds } from '@/server/entitlements';
import { getAdsAccounts, type AdsSearchParams } from '@/modules/ads/server/queries';
import { adsTranslator } from '@/modules/ads/copy';
import { loadAdsReportPolicy } from '@/modules/ads/server/report-policy';
import { readAdsComparison, type AdsComparisonResult } from '@/modules/ads/analysis/server';
import { pageSearchRecord } from '@/modules/ads/analysis/query';
import { adsFindingText, adsKpiLabel, adsLocale, adsText, type AdsCopyKey, type AdsLocale } from '@/modules/ads/analysis/copy';
import { AdsFiltersSidebar } from '@/modules/ads/ui/ads-filters';
import { AdsHeader } from '@/modules/ads/ui/AdsHeader';
import { loadAdsInsightsCopy } from '@/modules/ads/ui/ads-insights-server';
import { Button } from '@/components/Button';
import { parseAdsFilters, type AdsFilters } from '@/modules/ads/server/queries';
import { compareKindSwitch } from '@/modules/analytics/ui/compare/compareKindSwitch';

type Params = AdsSearchParams & { compare?: string; level?: string; sort?: string; direction?: string };
type Group = AdsComparisonResult['groups'][number];
type ObjectRow = Group['objects'][number];
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? undefined : value);
function formatMoney(locale: string, currency: string | null | undefined, value: number | null, fallback: string) {
  if (value === null || !Number.isFinite(value)) return fallback;
  if (currency) {
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { /* fall back */ }
  }
  return `${currency ? `${currency} ` : ''}${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}`;
}
function formatIsoDay(locale: string, value: string) {
  const day = value.slice(0, 10);
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed);
}

function Kpis({ group, locale, catalogs }: { group: Group; locale: AdsLocale; catalogs: Awaited<ReturnType<typeof loadAdsCopy>> }) {
  const t = (key: AdsCopyKey, values?: Record<string, string | number>) => adsText(locale, key, values, catalogs.analysis);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const show = (value: number | null) => (value === null ? t('unknown') : number.format(value));
  const showKpi = (key: string, value: number | null) => {
    if (value === null) return t('unknown');
    if ((key === 'spend' || key === 'cpc' || key === 'cpm') && group.currency) return formatMoney(locale, group.currency, value, t('unknown'));
    return `${show(value)}${key === 'ctr' ? '%' : ''}`;
  };
  return <dl className="ads-compare-grid">{group.kpis.map(kpi => <div key={kpi.key}>
    <dt>{adsKpiLabel(locale, kpi.key, catalogs.analysis)}</dt><dd>{showKpi(kpi.key, kpi.current)}</dd>
    <dd className="small-note">{kpi.changePercent === null ? (group.previous ? t('noChange') : t('noEarlier')) : `${t('vsEarlier', { percent: `${kpi.changePercent > 0 ? '+' : ''}${kpi.changePercent}%` })}${kpi.goodWhen === 'neutral' || kpi.direction === 'flat' ? '' : (kpi.direction === 'up') === (kpi.goodWhen === 'up') ? t('better') : t('worse')}`}</dd>
  </div>)}</dl>;
}

async function AdsComparePage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ feature: 'ads/compare', channelScoped: true });
  const params = await searchParams;
  const catalogs = await loadAdsCopy();
  const locale = adsLocale((await headers()).get('accept-language'));
  const t = (key: AdsCopyKey, values?: Record<string, string | number>) => adsText(locale, key, values, catalogs.analysis);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const show = (value: number | null) => (value === null ? t('unknown') : number.format(value));
  const policy = await loadAdsReportPolicy();
  const outputPolicy = await loadAdsOutputPolicy();
  const accounts = await getAdsAccounts(viewer.workspaceId, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, entitledPlatformIds(viewer.entitlements));
  const allowedKeys = ['period', 'since', 'until', 'account', 'compare', 'level', 'sort', 'direction'];
  const kindSwitch = await compareKindSwitch('ads', viewer);
  // One header (title, ⓘ, period presets, ad-account filter, Channels | Ad accounts switch) instead of a stacked form.
  let headerFilters: AdsFilters | null = null;
  try { headerFilters = parseAdsFilters(params, accounts.map(account => account.id), undefined, policy); } catch { headerFilters = null; }
  const { copy: insightsCopy } = await loadAdsInsightsCopy();
  const at = adsTranslator(catalogs, locale);
  const header = () => headerFilters
    ? <AdsHeader title={t('title')} copy={insightsCopy} locale={locale} policy={policy} filters={headerFilters} accounts={accounts}
      actions={kindSwitch} periodLabel={at('text081')} customLabel={at('text083')} />
    : <><AdsFiltersSidebar catalogs={catalogs} locale={locale} accounts={accounts} input={params} action="/ads/compare" policy={policy} /><PageHeader module="ads" title={t('title')} actions={kindSwitch} /></>;
  const hidden = (['period', 'since', 'until', 'account'] as const).map(key => first(params[key]) ? <input key={key} type="hidden" name={key} value={first(params[key])} /> : null);
  const sortLabels: Record<string, string> = { spend: t('col.spend'), impressions: t('col.impressions'), clicks: t('col.clicks'), ctr: t('col.ctr'), cpc: t('col.cpc'), cpm: t('col.cpm'), name: t('col.name') };
  const sidebar = <><form noValidate method="get" action="/ads/compare" className="ads-extra-filters" aria-label={t('optionsLabel')}>{hidden}
    <label>{t('compareLabel')}<select name="compare" defaultValue={first(params.compare) ?? 'previous'}><option value="previous">{t('comparePrevious')}</option><option value="accounts">{t('compareAccounts')}</option></select></label>
    <label>{t('show')}<select name="level" defaultValue={first(params.level) ?? 'campaign'}>{(['campaign', 'adset', 'ad'] as const).map(level => <option key={level} value={level}>{t(`level.${level}`)}</option>)}</select></label>
    <label>{t('sortBy')}<select name="sort" defaultValue={first(params.sort) ?? 'spend'}>{Object.entries(sortLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>{t('order')}<select name="direction" defaultValue={first(params.direction) ?? 'desc'}><option value="desc">{t('highest')}</option><option value="asc">{t('lowest')}</option></select></label>
    <Button type="submit" variant="secondary" size="sm">{t('apply')}</Button></form></>;
  let result: AdsComparisonResult;
  let values: Record<string, string | undefined>;
  try {
    values = pageSearchRecord(params, allowedKeys, policy.maxFilterCharacters);
    result = await readAdsComparison({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {
      ...(values.period ? { period: values.period } : {}), ...(values.since ? { start: values.since } : {}), ...(values.until ? { end: values.until } : {}),
      ...(values.account && values.account !== 'all' ? { accountId: values.account } : {}),
      ...(values.compare ? { compare: values.compare } : {}), ...(values.level ? { level: values.level } : {}),
      ...(values.sort ? { sort: values.sort } : {}), ...(values.direction ? { direction: values.direction } : {}),
    });
  } catch (error) {
    if (!(error instanceof OperationError)) throw error;
    return <PageFrame module="ads"><div className="page-stack">{header()}{sidebar}
      <section className="panel"><RouteNotice error className="ui-error" focusKey={localizeAdsMessage(catalogs, locale, error.message)}>{localizeAdsMessage(catalogs, locale, error.message)}</RouteNotice><p>{t('errorHint')}</p></section></div></PageFrame>;
  }
  const exportQuery = new URLSearchParams({ format: 'csv', locale });
  for (const [key, mapped] of [['period', 'period'], ['since', 'start'], ['until', 'end'], ['account', 'accountId'], ['compare', 'compare'], ['level', 'level'], ['sort', 'sort'], ['direction', 'direction']] as const) {
    const value = values[key];
    if (value && !(key === 'account' && value === 'all')) exportQuery.set(mapped, value);
  }
  const columns = (currency: string | null): TableColumn<ObjectRow>[] => [
    { key: 'name', label: t('col.name'), render: row => <>{row.name}<br /><span className="small-note">{row.accountName}</span>
      <ObjectPerformance copy={catalogs.analysis} row={row} locale={locale} currency={currency} compare={result.compare === 'previous'} />
      {Object.keys(row.actions).length ? <details><summary>{t('metricDetails')}</summary><p className="small-note">{t('periodActions')}</p><dl>{Object.entries(row.actions).map(([key, count]) => <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{number.format(count)}</dd></div>)}</dl></details> : null}</> },
    { key: 'spend', label: t('col.spend'), align: 'end', render: row => formatMoney(locale, currency, row.spend, t('unknown')) },
    { key: 'share', label: t('col.share'), align: 'end', render: row => row.sharePercent === null ? t('unknown') : <><meter min={0} max={100} value={row.sharePercent} aria-label={t('col.share')} /> {row.sharePercent}%</> },
    { key: 'impressions', label: t('col.impressions'), align: 'end', render: row => show(row.impressions) },
    { key: 'clicks', label: t('col.clicks'), align: 'end', render: row => show(row.clicks) },
    { key: 'ctr', label: t('col.ctr'), align: 'end', render: row => row.ctr === null ? t('unknown') : `${show(row.ctr)}%` },
    { key: 'cpc', label: t('col.cpc'), align: 'end', render: row => formatMoney(locale, currency, row.cpc, t('unknown')) },
    { key: 'cpm', label: t('col.cpm'), align: 'end', render: row => formatMoney(locale, currency, row.cpm, t('unknown')) },
    { key: 'reach', label: t('col.reach'), align: 'end', render: row => show(row.reachPeakDay) },
  ];
  return <PageFrame module="ads"><div className="page-stack">
    {header()}
    {sidebar}
    <div className="ads-compare-status">
      <p className="small-note" role="status">{t('rangeLine', { from: formatIsoDay(locale, result.range.from), to: formatIsoDay(locale, result.range.to) })}{result.previousRange ? t('earlierLine', { from: formatIsoDay(locale, result.previousRange.from), to: formatIsoDay(locale, result.previousRange.to) }) : ''}</p>
      {result.groups.length ? <ComparisonExport href={`/api/ads/compare?${exportQuery.toString()}`} locale={locale} maxBytes={outputPolicy.exportMaxBytes} /> : null}
    </div>
    {!result.groups.length ? <section className="panel empty-state"><h2>{t('emptyTitle')}</h2><p>{t('emptyHint')}</p></section> : result.groups.map(group => <section key={group.key} className="panel" aria-labelledby={`g-${group.key}`}>
      <h2 id={`g-${group.key}`}>{result.compare === 'accounts' ? group.accounts[0]?.name : `${group.currency ?? t('unknown')} · ${group.accounts.map(account => account.name).join(', ')}`}</h2>
      {!group.hasData ? <p>{t('noGroupData')}</p> : <>
        <p className="small-note">{group.freshness.status === 'stale' ? t('staleData') : ''}{group.freshness.newestFetchAt ? t('updatedAt', { when: new Date(group.freshness.newestFetchAt).toLocaleString(locale) }) : t('updateUnknown')}{group.totals ? t('dayCount', { days: group.totals.days }) : ''}
          {group.coverage ? ` ${t('coverageLine', { from: formatIsoDay(locale, group.coverage.firstDay), to: formatIsoDay(locale, group.coverage.lastDay) })}` : ''}</p>
        <ul className="small-note" aria-label={t('updatedAt', { when: '' })}>{group.accounts.map(account => <li key={account.id}>{account.lastSyncedAt ? t('syncedLine', { account: account.name, when: new Date(account.lastSyncedAt).toLocaleString(locale) }) : t('neverSynced', { account: account.name })}</li>)}</ul>
        {group.accountTotalsAvailable ? <Kpis group={group} locale={locale} catalogs={catalogs} /> : <p className="small-note">{t('noAccountTotals')}</p>}
        {group.findings.length ? <ul aria-label={t('findingsLabel')}>{group.findings.map(finding => <li key={finding.key}>{adsFindingText(locale, finding.key, finding.params, catalogs.analysis)}</li>)}</ul> : null}
        {group.accountTotalsAvailable && <TimeSeriesChart locale={locale} label={`${group.accounts.map(account => account.name).join(', ')} · ${t('col.spend')}`} format={group.currency ? { style: 'currency', currency: group.currency } : undefined}
          series={[{ id: 'spend', name: t('col.spend'), points: group.trend.map(day => ({ t: day.date, v: day.spend })) }]} />}
        {group.accountTotalsAvailable ? <details><summary>{t('dailyTrend')}</summary><DataTable caption={t('dailyCaption')} rows={group.trend} rowKey={row => row.date} columns={[
          { key: 'date', label: t('day'), render: row => formatIsoDay(locale, row.date) }, { key: 'spend', label: t('col.spend'), align: 'end', render: row => formatMoney(locale, group.currency, row.spend, t('unknown')) }, { key: 'clicks', label: t('col.clicks'), align: 'end', render: row => show(row.clicks) }]} /></details>
          : null}
        {Object.keys(group.actions).length ? <details><summary>{t('actionsTitle')}</summary><p className="small-note">{t('actionsHint')}</p><DataTable caption={t('actionsTitle')} rows={Object.entries(group.actions)} rowKey={([key]) => key} columns={[
          { key: 'type', label: t('actionsTitle'), render: ([key]) => key.replace(/_/g, ' ') }, { key: 'count', label: t('col.count'), align: 'end', render: ([, count]) => number.format(count) }]} /></details> : null}
        <DataTable caption={t('figuresCaption', { level: t(`level.${result.level}`) })} rows={group.objects} rowKey={row => `${row.accountId}:${row.objectId}`} columns={columns(group.currency)} emptyMessage={t('noObjects')} />
        {group.objectCount > group.objects.length ? <p className="small-note">{t('showing', { shown: group.objects.length, total: group.objectCount })}</p> : null}
      </>}
    </section>)}
    <p className="small-note">{t('reachNote')}</p>
  </div></PageFrame>;
}

export default async function AdsCopyScreen(props: Parameters<typeof AdsComparePage>[0]) {
  const catalogs = await loadAdsCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <AdsCopyProvider catalogs={catalogs} locale={locale}>{await AdsComparePage(props)}</AdsCopyProvider>;
}
