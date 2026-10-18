import { entitledPlatformIds } from '@/server/entitlements';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { AdsFilterErrorView, AdsReportFailureView, AdsReportSidebar, dateRangeLabel } from '../ads-filters';
import { getAdsAccounts, getAdsDataset, parseAdsFilters, AdsFilterError, type AdsSearchParams } from '@/server/ads/queries';
import { groupSummariesByAccount, summarizeInsights } from '@/server/ads/summary';
import { DailyMetrics } from '../DailyMetrics';
import { canManageWorkspaceAds, canReadWorkspaceAds } from '@/server/ads/actions';
import { AdsObjectActions } from '../AdsObjectActions';
import { CampaignCreateForm } from '../CampaignCreateForm';
import { AdSetCreateForm } from '../AdSetCreateForm';
import { platformAds } from '@/server/platforms/registry';
import { loadAdsReportPolicy } from '@/modules/ads/server/report-policy';
import { pageAdsRows, parseAdsResultPage } from '@/modules/ads/report-page';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadAdsOutputPolicy } from '@/modules/ads/server/output-policy';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const money = (value: number | null, currency: string | null) => value === null ? '—' : `${currency ? `${currency} ` : ''}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const date = (value: Date) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(value);

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<AdsSearchParams & { page?: string | string[] }> }) {
  const viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true });
  const { workspaceId } = viewer;
  const policy = await loadAdsReportPolicy();
  const allowedProviders = entitledPlatformIds(viewer.entitlements);
  const allowedTargetIds = viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids;
  const [params, accounts] = await Promise.all([searchParams, getAdsAccounts(workspaceId, allowedTargetIds, allowedProviders)]);
  let filters;
  try { filters = parseAdsFilters(params, accounts.map(account => account.id), undefined, policy); }
  catch (error) { if (!(error instanceof AdsFilterError)) throw error; return <AdsFilterErrorView accounts={accounts} input={params} error={error} action="/ads/campaigns" title="Campaign, ad set, and ad results" policy={policy} />; }
  let requestedPage: number;
  try { requestedPage = parseAdsResultPage(params.page); }
  catch (error) { return <AdsReportFailureView accounts={accounts} input={params} filters={filters} error={error} action="/ads/campaigns" title="Campaign, ad set, and ad results" policy={policy} />; }
  let dataset;
  try { dataset = await getAdsDataset(workspaceId, filters, allowedTargetIds, allowedProviders, { levels: ['campaign', 'adset', 'ad'] }); }
  catch (error) { return <AdsReportFailureView accounts={accounts} input={params} filters={filters} error={error} action="/ads/campaigns" title="Campaign, ad set, and ad results" policy={policy} />; }
  const summaries = summarizeInsights(dataset.insights).filter(row => ['campaign', 'adset', 'ad'].includes(row.level))
    .sort((left, right) => left.accountName.localeCompare(right.accountName) || left.level.localeCompare(right.level) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const objectPage = pageAdsRows(summaries, requestedPage, dataset.pageSize);
  const byAccount = groupSummariesByAccount(objectPage.items);
  const actionAvailability = new Map(await Promise.all([...byAccount.keys()].map(async accountId => [
    accountId,
    await canManageWorkspaceAds({ userId: viewer.user.id, workspaceId }, accountId),
  ] as const)));
  const readAvailability = new Map(await Promise.all([...byAccount.keys()].map(async accountId => [
    accountId,
    await canReadWorkspaceAds({ userId: viewer.user.id, workspaceId }, accountId, allowedTargetIds),
  ] as const)));
  const createAvailability = new Map(await Promise.all(accounts.map(async account => [account.id, await canManageWorkspaceAds({ userId: viewer.user.id, workspaceId }, account.id)] as const)));
  const adsUi = new Map(await Promise.all(accounts.map(async account => {
    const host = account.socialAccount ? await platformAds(account.socialAccount.provider) : null;
    const ui = host?.creationUi ? await host.creationUi().catch(() => null) : host?.ui ?? null;
    return [account.id, ui] as const;
  })));
  const canExport = canUseFeature(viewer.entitlements, 'ads/campaigns') && canAccessFeature(viewer.permissions, 'ads/campaigns', 'read');
  const exportPolicy = canExport ? await loadAdsOutputPolicy().catch(() => null) : null;
  const sidebar = <AdsReportSidebar accounts={accounts} filters={filters} action="/ads/campaigns" kind="objects" policy={policy} page={objectPage} canExport={canExport} maxRows={dataset.maxRows} exportPolicy={exportPolicy ?? undefined} />;
  return <PageFrame module="ads" sidebar={accounts.length ? sidebar : undefined}><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Ads / Performance</p><h1>Campaign, ad set, and ad results</h1><p>{accounts.length ? `Showing ${objectPage.from}–${objectPage.to} of ${objectPage.resultCount} objects · Page ${objectPage.page} of ${objectPage.pageCount}. Stored daily insight records · ${dateRangeLabel(filters)}. Select an account and date range in the sidebar.` : 'Connect an advertising account to review and manage its campaigns.'}</p></div></header>
    {!accounts.length ? <section className="panel empty-state"><h2>No ad accounts connected</h2><p>Connect and select an advertising account to see campaign results and available actions here.</p><a className="text-link" href="/settings/connections">View connections</a></section> : <>
    {objectPage.resultCount ? [...byAccount].map(([accountId, rows]) => {
      const account = accounts.find(item => item.id === accountId);
      const levels = [
        { value: 'campaign', label: 'Campaigns' }, { value: 'adset', label: 'Ad sets' }, { value: 'ad', label: 'Ads' },
      ];
      return <section className="panel ads-results-panel" key={accountId}>
        <div className="analytics-panel-title"><div><h2>{rows[0]?.accountName ?? account?.name ?? 'Ad account'}</h2><p className="small-note">{account?.actId}{account?.currency ? ` · ${account.currency}` : ''}</p></div><span className="badge">{rows.length} objects</span></div>
        {levels.map(level => {
          const levelRows = rows.filter(row => row.level === level.value);
          if (!levelRows.length) return null;
          return <div className="ads-result-level" key={level.value}><h3>{level.label}</h3><div className="ads-performance-mobile" role="region" aria-label={`${level.label} results`}>
            {levelRows.map(row => <article className="ads-performance-card" key={row.key}>
              <header className="ads-performance-card__heading"><div><strong>{row.name}</strong><small className="ads-object-id">{row.id}</small></div><span>{row.rows} daily row{row.rows === 1 ? '' : 's'}</span></header>
              {readAvailability.get(accountId) || actionAvailability.get(accountId) ? <AdsObjectActions adAccountId={accountId} objectId={row.id} name={row.name} objectType={row.level as 'campaign' | 'adset' | 'ad'} currency={row.currency} canRead={Boolean(readAvailability.get(accountId))} canManage={Boolean(actionAvailability.get(accountId))} /> : null}
              <dl className="ads-performance-card__metrics">
                <div><dt>Spend</dt><dd>{money(row.spend, row.currency)}</dd></div><div><dt>Impressions</dt><dd>{number.format(row.impressions)}</dd></div>
                <div><dt>Latest reach</dt><dd>{number.format(row.reach)}<small>{date(row.reachDate)}</small></dd></div><div><dt>Clicks</dt><dd>{number.format(row.clicks)}</dd></div>
                <div><dt>CPC</dt><dd>{money(row.cpc, row.currency)}</dd></div><div><dt>CPM</dt><dd>{money(row.cpm, row.currency)}</dd></div>
                <div><dt>CTR</dt><dd>{row.ctr === null ? '—' : `${number.format(row.ctr)}%`}</dd></div><div><dt>CPP</dt><dd>{money(row.cpp, row.currency)}</dd></div>
                <div><dt>Frequency</dt><dd>{row.frequency === null ? '—' : number.format(row.frequency)}</dd></div>
              </dl>
              <details className="ads-stored-details"><summary>Stored details</summary><div className="ads-detail-content"><h4>Action metrics · summed across daily rows</h4>{row.actions.length ? <ul>{row.actions.map(action => <li key={action.name}><span>{action.name}</span><strong>{number.format(action.value)}</strong></li>)}</ul> : <p>No action breakdown stored.</p>}<h4>Daily measures</h4><DailyMetrics rows={row.dailyMetrics} currency={row.currency} /></div></details>
            </article>)}
          </div><div className="ui-table-wrap"><table className="ui-table ads-performance-table"><caption className="ui-visually-hidden">{`${level.label} results for ${account?.name ?? rows[0]?.accountName ?? "ad account"}`}</caption><thead><tr><th scope="col">{level.label.slice(0, -1)} name</th><th scope="col">Daily rows</th><th scope="col" className="is-end">Spend</th><th scope="col" className="is-end">Impressions</th><th scope="col" className="is-end">Latest reach</th><th scope="col" className="is-end">Clicks</th><th scope="col" className="is-end">CPC</th><th scope="col" className="is-end">CPM</th><th scope="col" className="is-end">CTR</th><th scope="col" className="is-end">CPP</th><th scope="col" className="is-end">Freq.</th><th scope="col">Stored details</th></tr></thead>
            <tbody>{levelRows.map(row => <tr key={row.key}>
              <td><strong>{row.name}</strong><small className="ads-object-id">{row.id}</small>{readAvailability.get(accountId) || actionAvailability.get(accountId) ? <AdsObjectActions adAccountId={accountId} objectId={row.id} name={row.name} objectType={row.level as 'campaign' | 'adset' | 'ad'} currency={row.currency} canRead={Boolean(readAvailability.get(accountId))} canManage={Boolean(actionAvailability.get(accountId))} /> : null}</td>
              <td>{row.rows}</td><td className="is-end">{money(row.spend, row.currency)}</td><td className="is-end">{number.format(row.impressions)}</td><td className="is-end">{number.format(row.reach)}<small>{date(row.reachDate)}</small></td><td className="is-end">{number.format(row.clicks)}</td><td className="is-end">{money(row.cpc, row.currency)}</td><td className="is-end">{money(row.cpm, row.currency)}</td><td className="is-end">{row.ctr === null ? '—' : `${number.format(row.ctr)}%`}</td><td className="is-end">{money(row.cpp, row.currency)}</td><td className="is-end">{row.frequency === null ? '—' : number.format(row.frequency)}</td>
              <td><details className="ads-stored-details"><summary>{row.rows} daily row{row.rows === 1 ? '' : 's'}</summary><div className="ads-detail-content"><h4>Action metrics · summed across daily rows</h4>{row.actions.length ? <ul>{row.actions.map(action => <li key={action.name}><span>{action.name}</span><strong>{number.format(action.value)}</strong></li>)}</ul> : <p>No action breakdown stored.</p>}<h4>Daily measures</h4><DailyMetrics rows={row.dailyMetrics} currency={row.currency} /></div></details></td>
            </tr>)}</tbody></table></div></div>;
        })}
        {viewer.permissions.pageScope.all && actionAvailability.get(accountId) && adsUi.get(accountId)?.adSet && rows.some(row => row.level === 'campaign') ? <div className="ads-result-level"><h3>Create ad sets</h3><p className="small-note">Choose a campaign already verified in this account’s stored performance history.</p>
          {adsUi.get(accountId)?.adSet ? rows.filter(row => row.level === 'campaign').map(row => <AdSetCreateForm key={row.id} adAccountId={accountId} campaignId={row.id} campaignName={row.name} currency={row.currency} config={adsUi.get(accountId)!.adSet!} ownerScope={{ userId: viewer.user.id, workspaceId }} />) : null}
        </div> : null}
      </section>;
    }) : <section className="panel"><div className="empty-state"><h2>No campaign, ad set, or ad insights stored</h2><p>When insight rows are captured for the selected ad accounts and dates, each level will appear here with its saved metrics.</p><a className="text-link" href="/ads">Return to ad accounts →</a></div></section>}
    {accounts.filter(account => !filters.accountId || account.id === filters.accountId).some(account => createAvailability.get(account.id) && adsUi.get(account.id)?.campaign) ? <section className="panel"><h2>Create a campaign</h2><p className="small-note">Each campaign is created paused under one enabled ad account.</p>
      {accounts.filter(account => !filters.accountId || account.id === filters.accountId).filter(account => createAvailability.get(account.id) && adsUi.get(account.id)?.campaign).map(account => <CampaignCreateForm key={account.id} adAccountId={account.id} accountName={account.name} config={adsUi.get(account.id)!.campaign!} ownerScope={{ userId: viewer.user.id, workspaceId }} />)}
    </section> : null}
    <p className="ads-read-only-note">Review delivery and adjust eligible campaigns, ad sets, and ads. Changes require confirmation before they are sent.</p>
    </>}
  </div></PageFrame>;
}
