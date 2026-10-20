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
import { loadAdsReportPolicy } from '@/modules/ads/server/report-policy';
import { readAdsComparison, type AdsComparisonResult } from '@/modules/ads/analysis/server';
import { pageSearchRecord } from '@/modules/ads/analysis/query';
import { adsFindingText, adsKpiLabel, adsLocale, adsText, type AdsCopyKey, type AdsLocale } from '@/modules/ads/analysis/copy';
import { AdsFiltersSidebar } from '@/modules/ads/ui/ads-filters';

type Params = AdsSearchParams & { compare?: string; level?: string; sort?: string; direction?: string };
type Group = AdsComparisonResult['groups'][number];
type ObjectRow = Group['objects'][number];
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? undefined : value);

function Kpis({ group, locale }: { group: Group; locale: AdsLocale }) {
  const t = (key: AdsCopyKey, values?: Record<string, string | number>) => adsText(locale, key, values);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const show = (value: number | null) => (value === null ? t('unknown') : number.format(value));
  return <dl className="ads-compare-grid">{group.kpis.map(kpi => <div key={kpi.key}>
    <dt>{adsKpiLabel(locale, kpi.key)}</dt><dd>{kpi.key === 'spend' && group.currency ? `${group.currency} ` : ''}{show(kpi.current)}{kpi.key === 'ctr' && kpi.current !== null ? '%' : ''}</dd>
    <dd className="small-note">{kpi.changePercent === null ? (group.previous ? t('noChange') : t('noEarlier')) : `${t('vsEarlier', { percent: `${kpi.changePercent > 0 ? '+' : ''}${kpi.changePercent}%` })}${kpi.goodWhen === 'neutral' || kpi.direction === 'flat' ? '' : (kpi.direction === 'up') === (kpi.goodWhen === 'up') ? t('better') : t('worse')}`}</dd>
  </div>)}</dl>;
}

export default async function AdsComparePage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ feature: 'ads/compare', channelScoped: true });
  const params = await searchParams;
  const locale = adsLocale((await headers()).get('accept-language'));
  const t = (key: AdsCopyKey, values?: Record<string, string | number>) => adsText(locale, key, values);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const show = (value: number | null) => (value === null ? t('unknown') : number.format(value));
  const policy = await loadAdsReportPolicy();
  const outputPolicy = await loadAdsOutputPolicy();
  const accounts = await getAdsAccounts(viewer.workspaceId, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, entitledPlatformIds(viewer.entitlements));
  const allowedKeys = ['period', 'since', 'until', 'account', 'compare', 'level', 'sort', 'direction'];
  const sidebarBase = <AdsFiltersSidebar accounts={accounts} input={params} action="/ads/compare" policy={policy} />;
  const hidden = (['period', 'since', 'until', 'account'] as const).map(key => first(params[key]) ? <input key={key} type="hidden" name={key} value={first(params[key])} /> : null);
  const sortLabels: Record<string, string> = { spend: t('col.spend'), impressions: t('col.impressions'), clicks: t('col.clicks'), ctr: t('col.ctr'), cpc: t('col.cpc'), cpm: t('col.cpm'), name: t('col.name') };
  const sidebar = <>{sidebarBase}<form noValidate method="get" action="/ads/compare" className="ads-extra-filters" aria-label={t('optionsLabel')}>{hidden}
    <label>{t('compareLabel')}<select name="compare" defaultValue={first(params.compare) ?? 'previous'}><option value="previous">{t('comparePrevious')}</option><option value="accounts">{t('compareAccounts')}</option></select></label>
    <label>{t('show')}<select name="level" defaultValue={first(params.level) ?? 'campaign'}>{(['campaign', 'adset', 'ad'] as const).map(level => <option key={level} value={level}>{t(`level.${level}`)}</option>)}</select></label>
    <label>{t('sortBy')}<select name="sort" defaultValue={first(params.sort) ?? 'spend'}>{Object.entries(sortLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>{t('order')}<select name="direction" defaultValue={first(params.direction) ?? 'desc'}><option value="desc">{t('highest')}</option><option value="asc">{t('lowest')}</option></select></label>
    <button type="submit">{t('apply')}</button></form></>;
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
    return <PageFrame module="ads" sidebar={sidebar}><div className="page-stack"><PageHeader module="ads" title={t('title')} />
      <section className="panel"><RouteNotice error className="ui-error" focusKey={error.message}>{error.message}</RouteNotice><p>{t('errorHint')}</p></section></div></PageFrame>;
  }
  const exportQuery = new URLSearchParams({ format: 'csv', locale });
  for (const [key, mapped] of [['period', 'period'], ['since', 'start'], ['until', 'end'], ['account', 'accountId'], ['compare', 'compare'], ['level', 'level'], ['sort', 'sort'], ['direction', 'direction']] as const) {
    const value = values[key];
    if (value && !(key === 'account' && value === 'all')) exportQuery.set(mapped, value);
  }
  const columns = (currency: string | null): TableColumn<ObjectRow>[] => [
    { key: 'name', label: t('col.name'), render: row => <>{row.name}<br /><span className="small-note">{row.accountName}</span>
      <ObjectPerformance row={row} locale={locale} currency={currency} compare={result.compare === 'previous'} />
      {Object.keys(row.actions).length ? <details><summary>{t('metricDetails')}</summary><p className="small-note">{t('periodActions')}</p><dl>{Object.entries(row.actions).map(([key, count]) => <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{number.format(count)}</dd></div>)}</dl></details> : null}</> },
    { key: 'spend', label: t('col.spend'), align: 'end', render: row => `${currency ? `${currency} ` : ''}${show(row.spend)}` },
    { key: 'share', label: t('col.share'), align: 'end', render: row => row.sharePercent === null ? t('unknown') : <><meter min={0} max={100} value={row.sharePercent} aria-label={t('col.share')} /> {row.sharePercent}%</> },
    { key: 'impressions', label: t('col.impressions'), align: 'end', render: row => show(row.impressions) },
    { key: 'clicks', label: t('col.clicks'), align: 'end', render: row => show(row.clicks) },
    { key: 'ctr', label: t('col.ctr'), align: 'end', render: row => row.ctr === null ? t('unknown') : `${show(row.ctr)}%` },
    { key: 'cpc', label: t('col.cpc'), align: 'end', render: row => show(row.cpc) },
    { key: 'cpm', label: t('col.cpm'), align: 'end', render: row => show(row.cpm) },
    { key: 'reach', label: t('col.reach'), align: 'end', render: row => show(row.reachPeakDay) },
  ];
  return <PageFrame module="ads" sidebar={sidebar}><div className="page-stack">
    <PageHeader module="ads" title={t('title')} description={<>{t('rangeLine', { from: result.range.from, to: result.range.to })}{result.previousRange ? t('earlierLine', { from: result.previousRange.from, to: result.previousRange.to }) : ''}</>} />
      {result.groups.length ? <ComparisonExport href={`/api/ads/compare?${exportQuery.toString()}`} locale={locale} maxBytes={outputPolicy.exportMaxBytes} /> : null}
    {!result.groups.length ? <section className="panel empty-state"><h2>{t('emptyTitle')}</h2><p>{t('emptyHint')}</p></section> : result.groups.map(group => <section key={group.key} className="panel" aria-labelledby={`g-${group.key}`}>
      <h2 id={`g-${group.key}`}>{result.compare === 'accounts' ? group.accounts[0]?.name : `${group.currency ?? t('unknown')} · ${group.accounts.map(account => account.name).join(', ')}`}</h2>
      {!group.hasData ? <p>{t('noGroupData')}</p> : <>
        <p className="small-note">{group.freshness.status === 'stale' ? t('staleData') : ''}{group.freshness.newestFetchAt ? t('updatedAt', { when: new Date(group.freshness.newestFetchAt).toLocaleString(locale) }) : t('updateUnknown')}{group.totals ? t('dayCount', { days: group.totals.days }) : ''}
          {group.coverage ? ` ${t('coverageLine', { from: group.coverage.firstDay, to: group.coverage.lastDay })}` : ''}</p>
        <ul className="small-note" aria-label={t('updatedAt', { when: '' })}>{group.accounts.map(account => <li key={account.id}>{account.lastSyncedAt ? t('syncedLine', { account: account.name, when: new Date(account.lastSyncedAt).toLocaleString(locale) }) : t('neverSynced', { account: account.name })}</li>)}</ul>
        {group.accountTotalsAvailable ? <Kpis group={group} locale={locale} /> : <p className="small-note">{t('noAccountTotals')}</p>}
        {group.findings.length ? <ul aria-label={t('findingsLabel')}>{group.findings.map(finding => <li key={finding.key}>{adsFindingText(locale, finding.key, finding.params)}</li>)}</ul> : null}
        {group.accountTotalsAvailable && <TimeSeriesChart locale={locale} label={`${group.accounts.map(account => account.name).join(', ')} · ${t('col.spend')}`} format={group.currency ? { style: 'currency', currency: group.currency } : undefined}
          series={[{ id: 'spend', name: t('col.spend'), points: group.trend.map(day => ({ t: day.date, v: day.spend })) }]} />}
        {group.accountTotalsAvailable ? <details><summary>{t('dailyTrend')}</summary><DataTable caption={t('dailyCaption')} rows={group.trend} rowKey={row => row.date} columns={[
          { key: 'date', label: t('day'), render: row => row.date }, { key: 'spend', label: t('col.spend'), align: 'end', render: row => show(row.spend) }, { key: 'clicks', label: t('col.clicks'), align: 'end', render: row => show(row.clicks) }]} /></details>
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
