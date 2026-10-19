import '../ads.css';
import '../objects/objects.css';
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
import { AdsFiltersSidebar } from '../ads-filters';

type Params = AdsSearchParams & { compare?: string; level?: string; sort?: string; direction?: string };
type Group = AdsComparisonResult['groups'][number];
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? undefined : value);
const KPI_LABEL: Record<string, string> = { spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks', ctr: 'Click-through rate', cpc: 'Cost per click', cpm: 'Cost per 1,000 views' };
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const show = (value: number | null) => (value === null ? 'Unknown' : number.format(value));

function Kpis({ group }: { group: Group }) {
  return <dl className="ads-compare-grid">{group.kpis.map(kpi => <div key={kpi.key}>
    <dt>{KPI_LABEL[kpi.key]}</dt><dd>{kpi.key === 'spend' && group.currency ? `${group.currency} ` : ''}{show(kpi.current)}{kpi.key === 'ctr' && kpi.current !== null ? '%' : ''}</dd>
    <dd className="small-note">{kpi.changePercent === null ? (group.previous ? 'No change figure' : 'No earlier data') : `${kpi.changePercent > 0 ? '+' : ''}${kpi.changePercent}% vs earlier${kpi.goodWhen === 'neutral' ? '' : (kpi.direction === 'up') === (kpi.goodWhen === 'up') ? ' (better)' : kpi.direction === 'flat' ? '' : ' (worse)'}`}</dd>
  </div>)}</dl>;
}

export default async function AdsComparePage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ feature: 'ads/compare', channelScoped: true });
  const params = await searchParams;
  const policy = await loadAdsReportPolicy();
  const accounts = await getAdsAccounts(viewer.workspaceId, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, entitledPlatformIds(viewer.entitlements));
  const allowedKeys = ['period', 'since', 'until', 'account', 'compare', 'level', 'sort', 'direction'];
  const sidebarBase = <AdsFiltersSidebar accounts={accounts} input={params} action="/ads/compare" policy={policy} />;
  const hidden = (['period', 'since', 'until', 'account'] as const).map(key => first(params[key]) ? <input key={key} type="hidden" name={key} value={first(params[key])} /> : null);
  const sidebar = <>{sidebarBase}<form noValidate method="get" action="/ads/compare" className="ads-extra-filters" aria-label="Comparison options">{hidden}
    <label>Compare<select name="compare" defaultValue={first(params.compare) ?? 'previous'}><option value="previous">With the previous period</option><option value="accounts">Across accounts</option></select></label>
    <label>Show<select name="level" defaultValue={first(params.level) ?? 'campaign'}><option value="campaign">Campaigns</option><option value="adset">Ad sets</option><option value="ad">Ads</option></select></label>
    <label>Sort by<select name="sort" defaultValue={first(params.sort) ?? 'spend'}>{Object.entries({ spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks', ctr: 'Click-through rate', cpc: 'Cost per click', cpm: 'Cost per 1,000 views', name: 'Name' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Order<select name="direction" defaultValue={first(params.direction) ?? 'desc'}><option value="desc">Highest first</option><option value="asc">Lowest first</option></select></label>
    <button type="submit">Apply</button></form></>;
  let result: AdsComparisonResult;
  try {
    const values = pageSearchRecord(params, allowedKeys, policy.maxFilterCharacters);
    result = await readAdsComparison({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {
      ...(values.period ? { period: values.period } : {}), ...(values.since ? { start: values.since } : {}), ...(values.until ? { end: values.until } : {}),
      ...(values.account && values.account !== 'all' ? { accountId: values.account } : {}),
      ...(values.compare ? { compare: values.compare } : {}), ...(values.level ? { level: values.level } : {}),
      ...(values.sort ? { sort: values.sort } : {}), ...(values.direction ? { direction: values.direction } : {}),
    });
  } catch (error) {
    if (!(error instanceof OperationError)) throw error;
    return <PageFrame module="ads" sidebar={sidebar}><div className="page-stack"><header className="page-heading"><div><p className="eyebrow">Ads / Compare</p><h1>Compare performance</h1></div></header>
      <section className="panel"><RouteNotice error className="ui-error" focusKey={error.message}>{error.message}</RouteNotice><p>Adjust your filters, or reset them, and try again.</p></section></div></PageFrame>;
  }
  const columns = (currency: string | null): TableColumn<Group['objects'][number]>[] => [
    { key: 'name', label: 'Name', render: row => row.name },
    { key: 'spend', label: 'Spend', align: 'end', render: row => `${currency ? `${currency} ` : ''}${show(row.spend)}` },
    { key: 'impressions', label: 'Impressions', align: 'end', render: row => show(row.impressions) },
    { key: 'clicks', label: 'Clicks', align: 'end', render: row => show(row.clicks) },
    { key: 'ctr', label: 'CTR', align: 'end', render: row => row.ctr === null ? 'Unknown' : `${show(row.ctr)}%` },
    { key: 'cpc', label: 'Cost per click', align: 'end', render: row => show(row.cpc) },
  ];
  return <PageFrame module="ads" sidebar={sidebar}><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Ads / Compare</p><h1>Compare performance</h1>
      <p>{result.range.from} to {result.range.to} (end excluded){result.previousRange ? ` · earlier period ${result.previousRange.from} to ${result.previousRange.to}` : ''}</p></div></header>
    {!result.groups.length ? <section className="panel empty-state"><h2>No ad data in this range</h2><p>Choose another range or account. Figures appear after an advertising account has synced.</p></section> : result.groups.map(group => <section key={group.key} className="panel" aria-labelledby={`g-${group.key}`}>
      <h2 id={`g-${group.key}`}>{result.compare === 'accounts' ? group.accounts[0]?.name : `${group.currency ?? 'Unknown currency'} · ${group.accounts.map(account => account.name).join(', ')}`}</h2>
      {!group.hasData ? <p>No stored data in this range. These figures are unknown, not zero.</p> : <>
        <p className="small-note">{group.freshness.status === 'stale' ? 'Data may be out of date. ' : ''}{group.freshness.newestFetchAt ? `Last updated ${new Date(group.freshness.newestFetchAt).toLocaleString()}.` : 'Update time unknown.'}{group.totals ? ` ${group.totals.days} day(s) of account data.` : ''}</p>
        {group.accountTotalsAvailable ? <Kpis group={group} /> : <p className="small-note">Account totals and daily trend are unavailable; object level rows are shown below.</p>}
        {group.findings.length ? <ul aria-label="Findings">{group.findings.map(finding => <li key={finding.key}>{finding.message}</li>)}</ul> : null}
        {group.accountTotalsAvailable ? <details><summary>Daily spend and clicks</summary><DataTable caption="Daily trend" rows={group.trend} rowKey={row => row.date} columns={[
          { key: 'date', label: 'Day', render: row => row.date }, { key: 'spend', label: 'Spend', align: 'end', render: row => show(row.spend) }, { key: 'clicks', label: 'Clicks', align: 'end', render: row => show(row.clicks) }]} /></details>
          : null}
        <DataTable caption={`${result.level} figures`} rows={group.objects} rowKey={row => `${row.accountId}:${row.objectId}`} columns={[
          { key: 'name', label: 'Name', render: row => <>{row.name}<br /><span className="small-note">{row.accountName}</span></> },
          ...columns(group.currency).filter(column => column.key !== 'name'),
        ]} emptyMessage="No objects at this level in this range." />
        {group.objectCount > group.objects.length ? <p className="small-note">Showing the first {group.objects.length} of {group.objectCount}.</p> : null}
      </>}
    </section>)}
    <p className="small-note">{result.notes.join(' ')}</p>
  </div></PageFrame>;
}
