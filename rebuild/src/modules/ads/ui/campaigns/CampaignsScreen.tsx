import { loadAdsCopy } from '@/modules/ads/server/copy';
import { customerText } from '@/modules/ads/copy';
import { AdsCopyProvider } from '@/modules/ads/ui/AdsCopyProvider';
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
import { AdCreateForm } from '@/modules/ads/ui/AdCreateForm';
import { platformAds } from '@/server/platforms/registry';
import { loadAdsReportPolicy } from '@/modules/ads/server/report-policy';
import { pageAdsRows, parseAdsResultPage } from '@/modules/ads/report-page';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadAdsOutputPolicy } from '@/modules/ads/server/output-policy';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const money = (value: number | null, currency: string | null) => value === null ? '—' : `${currency ? `${currency} ` : ''}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const date = (value: Date) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(value);

async function CampaignsPage({ searchParams }: { searchParams: Promise<AdsSearchParams & { page?: string | string[] }> }) {
  const viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true });
  const { workspaceId } = viewer;
  const locale = adsLocale((await headers()).get('accept-language'));
  const catalogs = await loadAdsCopy();
  const t = (key: Parameters<typeof customerText>[2], values?: Record<string, string | number>) => customerText(catalogs.customer, locale, key, values);
  const policy = await loadAdsReportPolicy();
  const allowedProviders = entitledPlatformIds(viewer.entitlements);
  const allowedTargetIds = viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids;
  const [params, accounts] = await Promise.all([searchParams, getAdsAccounts(workspaceId, allowedTargetIds, allowedProviders)]);
  let filters;
  try { filters = parseAdsFilters(params, accounts.map(account => account.id), undefined, policy); }
  catch (error) { if (!(error instanceof AdsFilterError)) throw error; return <AdsFilterErrorView catalogs={catalogs} locale={locale} accounts={accounts} input={params} error={error} action="/ads/campaigns" title={t('text041')} policy={policy} />; }
  let requestedPage: number;
  try { requestedPage = parseAdsResultPage(params.page); }
  catch (error) { return <AdsReportFailureView catalogs={catalogs} locale={locale} accounts={accounts} input={params} filters={filters} error={error} action="/ads/campaigns" title={t('text041')} policy={policy} />; }
  let dataset;
  try { dataset = await getAdsDataset(workspaceId, filters, allowedTargetIds, allowedProviders, { levels: ['campaign', 'adset', 'ad'] }); }
  catch (error) { return <AdsReportFailureView catalogs={catalogs} locale={locale} accounts={accounts} input={params} filters={filters} error={error} action="/ads/campaigns" title={t('text041')} policy={policy} />; }
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
  const managementByAccount = new Map(await Promise.all(accounts.map(async account => [account.id, await describeAdsManagement({ userId: viewer.user.id, workspaceId }, account.id)] as const)));
  const creativeAvailability = new Map([...managementByAccount].map(([id, management]) => [id, management.operations.some(op => op.id === 'creative.create')] as const));
  // A module that cannot offer ad creation, or a restricted page scope, never shows the form.
  const adCreateAvailability = new Map([...managementByAccount].map(([id, management]) => [id, viewer.permissions.pageScope.all && management.canManage && management.canListCreatives && management.operations.some(op => op.id === 'ad.create')] as const));
  const reconnectAccounts = new Set([...managementByAccount].filter(([, management]) => !management.canManage && management.needsReconnect === true).map(([id]) => id));
  const nameMaxByAccount = new Map([...managementByAccount].map(([id, management]) => [id, 'limits' in management && management.limits ? management.limits.nameMaxCharacters : 100] as const));
  const parentResolvers = new Map<string, ((input: { level: 'campaign' | 'adset' | 'ad'; fields: unknown }) => string | null) | undefined>();
  const adsUi = new Map(await Promise.all(accounts.map(async account => {
    const host = account.socialAccount ? await platformAds(account.socialAccount.provider, locale) : null;
    parentResolvers.set(account.id, host?.parentObjectId);
    const ui = host?.creationUi ? await host.creationUi().catch(() => null) : host?.ui ?? null;
    return [account.id, ui] as const;
  })));
  const canExport = canUseFeature(viewer.entitlements, 'ads/campaigns') && canAccessFeature(viewer.permissions, 'ads/campaigns', 'read');
  const exportPolicy = canExport ? await loadAdsOutputPolicy().catch(() => null) : null;
  const sidebar = <AdsReportSidebar catalogs={catalogs} locale={locale} accounts={accounts} filters={filters} action="/ads/campaigns" kind="objects" policy={policy} page={objectPage} canExport={canExport} maxRows={dataset.maxRows} exportPolicy={exportPolicy ?? undefined} />;
  return <PageFrame module="ads" sidebar={accounts.length ? sidebar : undefined}><div className="page-stack">
    <PageHeader module="ads" title={t('text041')} description={<>{accounts.length ? t('text260', { value0: objectPage.from, value1: objectPage.to, value2: objectPage.resultCount, value3: objectPage.page, value4: objectPage.pageCount, value5: dateRangeLabel(filters) }) : t('text042')}</>} />
    {!accounts.length ? <section className="panel"><EmptyState icon={<IconAd />} title={t('text003')} action={<a className="text-link" href="/settings/connections">{t('text004')}</a>}>{t('text043')}</EmptyState></section> : <>
    {objectPage.resultCount ? [...byAccount].map(([accountId, rows]) => {
      const account = accounts.find(item => item.id === accountId);
      const levels = [
        { value: 'campaign', label: t('text057') }, { value: 'adset', label: t('text058') }, { value: 'ad', label: t('text059') },
      ];
      return <section className="panel ads-results-panel" key={accountId}>
        <div className="analytics-panel-title"><div><h2>{rows[0]?.accountName ?? account?.name ?? t('text044')}</h2><p className="small-note">{account?.actId}{account?.currency ? ` · ${account.currency}` : ''}</p></div><span className="badge">{rows.length} {t('text045')}</span></div>
        <CampaignCharts accountName={rows[0]?.accountName ?? account?.name ?? t('text044')} rows={rows} locale={locale} />
        {reconnectAccounts.has(accountId) ? <p className="small-note" role="note">{t('needsReconnectAccount', { account: rows[0]?.accountName ?? account?.name ?? t('text044') })} <a href="/settings/connections">{t('needsReconnectAction')}</a></p> : null}
        <p className="small-note">{t('hierarchyNote')}</p>
        {levels.map(level => {
          const resolveParent = parentResolvers.get(accountId);
          const known = summaries.filter(row => row.accountId === accountId);
          const named = new Map(known.map(row => [`${row.level}:${row.id}`, row] as const));
          const parentOf = (row: typeof known[number]) => {
            const parentId = resolveParent && (row.level === 'adset' || row.level === 'ad') ? resolveParent({ level: row.level, fields: row.fields }) : null;
            return parentId ? named.get(`${row.level === 'ad' ? 'adset' : 'campaign'}:${parentId}`) : undefined;
          };
          // Campaign > ad set > ad: a row's path lists its ancestors that are present in stored data.
          const pathOf = (row: typeof known[number]) => {
            const parent = parentOf(row), grand = parent ? parentOf(parent) : undefined;
            return [grand?.name, parent?.name].filter(Boolean).join(' › ');
          };
          const levelRows = rows.filter(row => row.level === level.value).sort((a, b) => pathOf(a).localeCompare(pathOf(b)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
          if (!levelRows.length) return null;
          const slot = (row: typeof levelRows[number]) => readAvailability.get(accountId) || actionAvailability.get(accountId)
            ? <AdsObjectActions adAccountId={accountId} objectId={row.id} name={row.name} objectType={row.level as 'campaign' | 'adset' | 'ad'} currency={row.currency} canRead={Boolean(readAvailability.get(accountId))} canManage={Boolean(actionAvailability.get(accountId))} /> : null;
          return <div className="ads-result-level" key={level.value}><h3>{level.label}</h3>
            <HierarchyTable locale={locale} caption={t('resultsCaption', { level: level.label, account: account?.name ?? rows[0]?.accountName ?? t('accountFallback') })} objectsHref="/ads/objects"
              rows={levelRows.map(row => ({ key: row.key, id: row.id, name: row.name, level: row.level as 'campaign' | 'adset' | 'ad', currency: row.currency, spend: row.spend, impressions: row.impressions, clicks: row.clicks, ctr: row.ctr, cpc: row.cpc, days: row.rows, path: pathOf(row),
                spendSeries: [...row.dailyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime()).map(entry => entry.spend) }))}
              actions={Object.fromEntries(levelRows.map(row => [row.key, slot(row)]))}
              details={Object.fromEntries(levelRows.map(row => [row.key, <details className="ads-stored-details" key={row.key}><summary>{t('dailyRowCount', { count: row.rows, suffix: row.rows === 1 ? '' : 's' })}</summary><div className="ads-detail-content"><h4>{t('text029')}</h4>{row.actions.length ? <ul>{row.actions.map(action => <li key={action.name}><span>{action.name}</span><strong>{number.format(action.value)}</strong></li>)}</ul> : <p>{t('text030')}</p>}<h4>{t('text031')}</h4><DailyMetrics rows={row.dailyMetrics} currency={row.currency} /></div></details>]))} />
          </div>;
        })}
        {viewer.permissions.pageScope.all && actionAvailability.get(accountId) && adsUi.get(accountId)?.adSet && rows.some(row => row.level === 'campaign') ? <div className="ads-result-level"><h3>{t('text047')}</h3><p className="small-note">{t('text048')}</p>
          {adsUi.get(accountId)?.adSet ? rows.filter(row => row.level === 'campaign').map(row => <AdSetCreateForm key={row.id} adAccountId={accountId} campaignId={row.id} campaignName={row.name} currency={row.currency} config={adsUi.get(accountId)!.adSet!} ownerScope={{ userId: viewer.user.id, workspaceId }} />) : null}
        </div> : null}
        {adCreateAvailability.get(accountId) && rows.some(row => row.level === 'adset') ? <div className="ads-result-level"><h3>{t('adCreateAction')}</h3><p className="small-note">{t('adCreateDescription')}</p>
          {rows.filter(row => row.level === 'adset').map(row => <AdCreateForm key={row.id} adAccountId={accountId} adSetId={row.id} adSetName={row.name} nameMaxCharacters={nameMaxByAccount.get(accountId) ?? 100} />)}
        </div> : null}
      </section>;
    }) : <section className="panel"><EmptyState icon={<IconSpeakerphone />} title={t('text049')} action={<a className="text-link" href="/ads">{t('text050')}</a>}>{t('text051')}</EmptyState></section>}
    {accounts.filter(account => !filters.accountId || account.id === filters.accountId).some(account => createAvailability.get(account.id) && adsUi.get(account.id)?.campaign) ? <section className="panel"><h2>{t('text052')}</h2><p className="small-note">{t('text053')}</p>
      {accounts.filter(account => !filters.accountId || account.id === filters.accountId).filter(account => createAvailability.get(account.id) && adsUi.get(account.id)?.campaign).map(account => <CampaignCreateForm key={account.id} adAccountId={account.id} accountName={account.name} config={adsUi.get(account.id)!.campaign!} ownerScope={{ userId: viewer.user.id, workspaceId }} />)}
    </section> : null}
    {accounts.filter(account => (!filters.accountId || account.id === filters.accountId) && creativeAvailability.get(account.id)).map(account => <section className="panel" key={`creative:${account.id}`}><CreativeCreateForm adAccountId={account.id} accountName={account.name} ownerScope={{ userId: viewer.user.id, workspaceId }} locale={locale} /></section>)}
    <p className="ads-read-only-note">{t('text054')}</p>
    </>}
  </div></PageFrame>;
}

export default async function AdsCopyScreen(props: Parameters<typeof CampaignsPage>[0]) {
  const catalogs = await loadAdsCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <AdsCopyProvider catalogs={catalogs} locale={locale}>{await CampaignsPage(props)}</AdsCopyProvider>;
}
