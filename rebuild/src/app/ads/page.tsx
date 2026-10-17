import { entitledPlatformIds } from '@/server/entitlements';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { AdsFiltersSidebar, AdsFilterErrorView, adsQuery, dateRangeLabel } from './ads-filters';
import { getAdsAccounts, getAdsDataset, parseAdsFilters, AdsFilterError, type AdsSearchParams } from '@/server/ads/queries';
import { summarizeInsights } from '@/server/ads/summary';
import { StoredFields } from './stored-fields';
import { loadAdsReportPolicy } from '@/modules/ads/server/report-policy';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const money = (value: number | null, currency: string | null) => value === null ? '—' : `${currency ? `${currency} ` : ''}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export default async function AdsPage({ searchParams }: { searchParams: Promise<AdsSearchParams> }) {
  const { workspaceId, permissions, entitlements } = await requireViewer({ feature: 'ads/overview' });
  const policy = await loadAdsReportPolicy();
  const allowedTargetIds = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowedProviders = entitledPlatformIds(entitlements);
  const params = await searchParams;
  const accounts = await getAdsAccounts(workspaceId, allowedTargetIds, allowedProviders);
  let filters;
  try { filters = parseAdsFilters(params, accounts.map(account => account.id), undefined, policy); }
  catch (error) { if (!(error instanceof AdsFilterError)) throw error; return <AdsFilterErrorView accounts={accounts} input={params} error={error} action="/ads" title="Ad accounts" policy={policy} />; }
  const dataset = await getAdsDataset(workspaceId, filters, allowedTargetIds, allowedProviders);
  const accountSummaries = summarizeInsights(dataset.insights, 'account');
  const campaigns = summarizeInsights(dataset.insights, 'campaign');
  const adsets = summarizeInsights(dataset.insights, 'adset');
  const ads = summarizeInsights(dataset.insights, 'ad');
  const accountMetrics = new Map(accountSummaries.map(row => [row.accountId, row]));
  const visibleAccounts = filters.accountId ? dataset.accounts.filter(account => account.id === filters.accountId) : dataset.accounts;
  const enabled = visibleAccounts.filter(account => account.enabled).length;
  const synced = visibleAccounts.filter(account => account.lastSyncedAt).length;
  const sidebar = <AdsFiltersSidebar accounts={dataset.accounts} filters={filters} policy={policy} />;
  return <PageFrame module="ads" sidebar={dataset.accounts.length ? sidebar : undefined}><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Ads</p><h1>Ad accounts</h1><p>{dataset.accounts.length ? `Stored delivery performance · ${dateRangeLabel(filters)}. Account currencies remain separate.` : 'Connect the advertising accounts you want to manage.'}</p></div></header>
    {!dataset.accounts.length ? <section className="panel empty-state"><h2>No ad accounts connected</h2><p>Connect and select an advertising account to see delivery and manage campaigns here.</p><a className="text-link" href="/settings/connections">View connections</a></section> : <>
    <section className="metric-grid" aria-label="Advertising account totals">
      <article className="metric-card"><dl><dt>Linked accounts</dt><dd>{visibleAccounts.length}</dd></dl></article>
      <article className="metric-card"><dl><dt>Enabled accounts</dt><dd>{enabled}</dd></dl></article>
      <article className="metric-card"><dl><dt>Accounts with sync time</dt><dd>{synced}</dd></dl></article>
      <article className="metric-card"><dl><dt>Campaigns with data</dt><dd>{campaigns.length}</dd></dl></article>
    </section>
    <section className="panel"><div className="analytics-panel-title"><div><h2>Account performance</h2><p className="small-note">Daily spend, impressions, and clicks are summed. Reach, frequency, and CPP use the latest daily row.</p></div><a className="text-link" href={adsQuery(filters, '/ads/campaigns')}>Campaign, ad set, and ad details →</a></div>
      {visibleAccounts.length ? <div className="ads-account-list">{visibleAccounts.map(account => {
        const row = accountMetrics.get(account.id);
        return <article className="ads-account-card" key={account.id}>
          <div className="ads-account-card__heading"><div><span className="badge">{account.enabled ? 'Enabled' : 'Disabled'}</span><h3>{account.name}</h3><p className="small-note">{account.actId}{account.currency ? ` · ${account.currency}` : ''} · Platform status: {account.accountStatus ?? 'not provided'}</p></div><span className="ads-account-card__sync">{account.lastSyncedAt ? `Synced ${account.lastSyncedAt.toLocaleDateString()}` : 'No sync recorded'}</span></div>
          {row ? <><div className="ads-metric-strip"><span><small>Spend</small><strong>{money(row.spend, row.currency)}</strong></span><span><small>Impressions</small><strong>{number.format(row.impressions)}</strong></span><span><small>Reach · latest day</small><strong>{number.format(row.reach)}</strong></span><span><small>Clicks</small><strong>{number.format(row.clicks)}</strong></span><span><small>CPC</small><strong>{money(row.cpc, row.currency)}</strong></span><span><small>CPM</small><strong>{money(row.cpm, row.currency)}</strong></span><span><small>CTR</small><strong>{row.ctr === null ? '—' : `${number.format(row.ctr)}%`}</strong></span><span><small>CPP · latest day</small><strong>{money(row.cpp, row.currency)}</strong></span><span><small>Frequency · latest day</small><strong>{row.frequency === null ? '—' : number.format(row.frequency)}</strong></span></div><details className="ads-stored-details ads-account-details"><summary>Action and daily results</summary><div className="ads-detail-content"><h4>Action metrics · summed across daily rows</h4>{row.actions.length ? <ul>{row.actions.map(action => <li key={action.name}><span>{action.name}</span><strong>{number.format(action.value)}</strong></li>)}</ul> : <p>No action breakdown stored.</p>}<h4>Daily measures</h4>{row.dailyMetrics.map(day => <details className="ads-day-details" key={day.date.toISOString()}><summary>{day.date.toLocaleDateString()}</summary><p>CPC {money(day.cpc, row.currency)} · CPM {money(day.cpm, row.currency)} · CPP {money(day.cpp, row.currency)} · CTR {day.ctr === null ? '—' : `${number.format(day.ctr)}%`} · Frequency {day.frequency === null ? '—' : number.format(day.frequency)}</p><StoredFields actions={day.actions} fields={day.fields} /></details>)}</div></details></> : <p className="empty-note">No account-level delivery rows in this date range.</p>}
        </article>;
      })}</div> : <div className="empty-state"><h3>No ad accounts match these filters</h3><p>Choose another account in the sidebar.</p></div>}
    </section>
    <section className="panel"><div className="analytics-panel-title"><div><h2>Stored campaign, ad set, and ad rows</h2><p className="small-note">These are stored insight records in the selected period. Metrics across account currencies are not combined.</p></div></div>
      {dataset.insights.some(row => ['campaign', 'adset', 'ad'].includes(row.level)) ? <div className="report-list">{[
        { label: 'Campaigns', rows: campaigns }, { label: 'Ad sets', rows: adsets }, { label: 'Ads', rows: ads },
      ].map(section => <div className="ads-level-row" key={section.label}><span>{section.label}<small>{section.rows.length} with stored data</small></span><a className="text-link" href={adsQuery(filters, '/ads/campaigns')}>View performance →</a></div>)}</div> : <p className="empty-note">No campaign, ad set, or ad insight rows are stored in this date range.</p>}
      <p className="ads-read-only-note">Open campaign, ad set, and ad details to review performance. Management controls appear when available for your connected accounts.</p>
    </section>
    </>}
  </div></PageFrame>;
}
