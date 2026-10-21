import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { IconAd, IconSpeakerphone } from '@tabler/icons-react';
import { CampaignCharts } from './CampaignCharts';
import { HierarchyTable } from './HierarchyTable';
import { headers } from 'next/headers';
import { adsLocale } from '@/modules/ads/analysis/copy';
import { describeAdsManagement } from '@/modules/ads/management/server';
import { CreativeCreateForm } from '@/modules/ads/ui/CreativeCreateForm';
import { entitledPlatformIds } from '@/server/entitlements';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { AdsFilterErrorView, AdsReportFailureView, AdsReportSidebar, dateRangeLabel } from '@/modules/ads/ui/ads-filters';
import { getAdsAccounts, getAdsDataset, parseAdsFilters, AdsFilterError, type AdsSearchParams } from '@/modules/ads/server/queries';
import { groupSummariesByAccount, summarizeInsights } from '@/modules/ads/server/summary';
import { DailyMetrics } from '@/modules/ads/ui/DailyMetrics';
import { canManageWorkspaceAds, canReadWorkspaceAds } from '@/modules/ads/server/actions';
import { AdsObjectActions } from '@/modules/ads/ui/AdsObjectActions';
import { CampaignCreateForm } from '@/modules/ads/ui/CampaignCreateForm';
import { AdSetCreateForm } from '@/modules/ads/ui/AdSetCreateForm';
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
  const locale = adsLocale((await headers()).get('accept-language'));
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
  const creativeAvailability = new Map(await Promise.all(accounts.map(async account => [account.id, (await describeAdsManagement({ userId: viewer.user.id, workspaceId }, account.id)).operations.some(op => op.id === 'creative.create')] as const)));
  const adsUi = new Map(await Promise.all(accounts.map(async account => {
    const host = account.socialAccount ? await platformAds(account.socialAccount.provider) : null;
    const ui = host?.creationUi ? await host.creationUi().catch(() => null) : host?.ui ?? null;
    return [account.id, ui] as const;
  })));
  const canExport = canUseFeature(viewer.entitlements, 'ads/campaigns') && canAccessFeature(viewer.permissions, 'ads/campaigns', 'read');
  const exportPolicy = canExport ? await loadAdsOutputPolicy().catch(() => null) : null;
  const sidebar = <AdsReportSidebar accounts={accounts} filters={filters} action="/ads/campaigns" kind="objects" policy={policy} page={objectPage} canExport={canExport} maxRows={dataset.maxRows} exportPolicy={exportPolicy ?? undefined} />;
  return <PageFrame module="ads" sidebar={accounts.length ? sidebar : undefined}><div className="page-stack">
    <PageHeader module="ads" title={"Campaign, ad set, and ad results"} description={<>{accounts.length ? `Showing ${objectPage.from}–${objectPage.to} of ${objectPage.resultCount} objects · Page ${objectPage.page} of ${objectPage.pageCount}. Stored daily insight records · ${dateRangeLabel(filters)}. Select an account and date range in the sidebar.` : 'Connect an advertising account to review and manage its campaigns.'}</>} />
    {!accounts.length ? <section className="panel"><EmptyState icon={<IconAd />} title="No ad accounts connected" action={<a className="text-link" href="/settings/connections">View connections</a>}>Connect and select an advertising account to see campaign results and available actions here.</EmptyState></section> : <>
    {objectPage.resultCount ? [...byAccount].map(([accountId, rows]) => {
      const account = accounts.find(item => item.id === accountId);
      const levels = [
        { value: 'campaign', label: 'Campaigns' }, { value: 'adset', label: 'Ad sets' }, { value: 'ad', label: 'Ads' },
      ];
      return <section className="panel ads-results-panel" key={accountId}>
        <div className="analytics-panel-title"><div><h2>{rows[0]?.accountName ?? account?.name ?? 'Ad account'}</h2><p className="small-note">{account?.actId}{account?.currency ? ` · ${account.currency}` : ''}</p></div><span className="badge">{rows.length} objects</span></div>
        <CampaignCharts accountName={rows[0]?.accountName ?? account?.name ?? 'Ad account'} rows={rows} locale={locale} />
        {levels.map(level => {
          const levelRows = rows.filter(row => row.level === level.value);
          if (!levelRows.length) return null;
          const slot = (row: typeof levelRows[number]) => readAvailability.get(accountId) || actionAvailability.get(accountId)
            ? <AdsObjectActions adAccountId={accountId} objectId={row.id} name={row.name} objectType={row.level as 'campaign' | 'adset' | 'ad'} currency={row.currency} canRead={Boolean(readAvailability.get(accountId))} canManage={Boolean(actionAvailability.get(accountId))} /> : null;
          return <div className="ads-result-level" key={level.value}><h3>{level.label}</h3>
            <HierarchyTable locale={locale} caption={`${level.label} results for ${account?.name ?? rows[0]?.accountName ?? 'ad account'}`} objectsHref="/ads/objects"
              rows={levelRows.map(row => ({ key: row.key, id: row.id, name: row.name, level: row.level as 'campaign' | 'adset' | 'ad', currency: row.currency, spend: row.spend, impressions: row.impressions, clicks: row.clicks, ctr: row.ctr, cpc: row.cpc, days: row.rows,
                spendSeries: [...row.dailyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime()).map(entry => entry.spend) }))}
              actions={Object.fromEntries(levelRows.map(row => [row.key, slot(row)]))}
              details={Object.fromEntries(levelRows.map(row => [row.key, <details className="ads-stored-details" key={row.key}><summary>{row.rows} daily row{row.rows === 1 ? '' : 's'}</summary><div className="ads-detail-content"><h4>Action metrics · summed across daily rows</h4>{row.actions.length ? <ul>{row.actions.map(action => <li key={action.name}><span>{action.name}</span><strong>{number.format(action.value)}</strong></li>)}</ul> : <p>No action breakdown stored.</p>}<h4>Daily measures</h4><DailyMetrics rows={row.dailyMetrics} currency={row.currency} /></div></details>]))} />
          </div>;
        })}
        {viewer.permissions.pageScope.all && actionAvailability.get(accountId) && adsUi.get(accountId)?.adSet && rows.some(row => row.level === 'campaign') ? <div className="ads-result-level"><h3>Create ad sets</h3><p className="small-note">Choose a campaign already verified in this account’s stored performance history.</p>
          {adsUi.get(accountId)?.adSet ? rows.filter(row => row.level === 'campaign').map(row => <AdSetCreateForm key={row.id} adAccountId={accountId} campaignId={row.id} campaignName={row.name} currency={row.currency} config={adsUi.get(accountId)!.adSet!} ownerScope={{ userId: viewer.user.id, workspaceId }} />) : null}
        </div> : null}
      </section>;
    }) : <section className="panel"><EmptyState icon={<IconSpeakerphone />} title="No campaign, ad set, or ad insights stored" action={<a className="text-link" href="/ads">Return to ad accounts →</a>}>When insight rows are captured for the selected ad accounts and dates, each level will appear here with its saved metrics.</EmptyState></section>}
    {accounts.filter(account => !filters.accountId || account.id === filters.accountId).some(account => createAvailability.get(account.id) && adsUi.get(account.id)?.campaign) ? <section className="panel"><h2>Create a campaign</h2><p className="small-note">Each campaign is created paused under one enabled ad account.</p>
      {accounts.filter(account => !filters.accountId || account.id === filters.accountId).filter(account => createAvailability.get(account.id) && adsUi.get(account.id)?.campaign).map(account => <CampaignCreateForm key={account.id} adAccountId={account.id} accountName={account.name} config={adsUi.get(account.id)!.campaign!} ownerScope={{ userId: viewer.user.id, workspaceId }} />)}
    </section> : null}
    {accounts.filter(account => (!filters.accountId || account.id === filters.accountId) && creativeAvailability.get(account.id)).map(account => <section className="panel" key={`creative:${account.id}`}><CreativeCreateForm adAccountId={account.id} accountName={account.name} ownerScope={{ userId: viewer.user.id, workspaceId }} locale={locale} /></section>)}
    <p className="ads-read-only-note">Review delivery and adjust eligible campaigns, ad sets, and ads. Changes require confirmation before they are sent.</p>
    </>}
  </div></PageFrame>;
}
