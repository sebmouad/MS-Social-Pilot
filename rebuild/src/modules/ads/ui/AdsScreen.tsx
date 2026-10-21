import { loadAdsCopy } from '@/modules/ads/server/copy';
import { customerText } from '@/modules/ads/copy';
import { AdsCopyProvider } from '@/modules/ads/ui/AdsCopyProvider';
import { headers } from 'next/headers';
import { AccountCharts } from './AccountCharts';
import { EmptyState } from '@/components/EmptyState';
import { IconAd } from '@tabler/icons-react';
import { Badge } from '@/components/Badge';
import { PageHeader } from '@/components/PageHeader';
import { entitledPlatformIds } from '@/server/entitlements';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { AdsFilterErrorView, AdsReportFailureView, AdsReportSidebar, adsQuery, dateRangeLabel } from './ads-filters';
import { getAdsAccounts, getAdsDataset, parseAdsFilters, AdsFilterError, type AdsSearchParams } from '@/modules/ads/server/queries';
import { summarizeInsights } from '@/modules/ads/server/summary';
import { DailyMetrics } from './DailyMetrics';
import { loadAdsReportPolicy } from '@/modules/ads/server/report-policy';
import { parseAdsResultPage, pageAdsRows } from '@/modules/ads/report-page';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadAdsOutputPolicy } from '@/modules/ads/server/output-policy';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const money = (value: number | null, currency: string | null) => value === null ? '—' : `${currency ? `${currency} ` : ''}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

async function AdsPage({ searchParams }: { searchParams: Promise<AdsSearchParams & { page?: string | string[] }> }) {
  const { workspaceId, permissions, entitlements } = await requireViewer({ feature: 'ads/overview', channelScoped: true });
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const catalogs = await loadAdsCopy();
  const t = (key: Parameters<typeof customerText>[2], values?: Record<string, string | number>) => customerText(catalogs.customer, locale, key, values);
  const policy = await loadAdsReportPolicy();
  const allowedTargetIds = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowedProviders = entitledPlatformIds(entitlements);
  const params = await searchParams;
  const accounts = await getAdsAccounts(workspaceId, allowedTargetIds, allowedProviders);
  let filters;
  try { filters = parseAdsFilters(params, accounts.map(account => account.id), undefined, policy); }
  catch (error) { if (!(error instanceof AdsFilterError)) throw error; return <AdsFilterErrorView catalogs={catalogs} locale={locale} accounts={accounts} input={params} error={error} action="/ads" title={t('text001')} policy={policy} />; }
  let requestedPage: number;
  try { requestedPage = parseAdsResultPage(params.page); }
  catch (error) { return <AdsReportFailureView catalogs={catalogs} locale={locale} accounts={accounts} input={params} filters={filters} error={error} action="/ads" title={t('text001')} policy={policy} />; }
  let dataset;
  try { dataset = await getAdsDataset(workspaceId, filters, allowedTargetIds, allowedProviders); }
  catch (error) { return <AdsReportFailureView catalogs={catalogs} locale={locale} accounts={accounts} input={params} filters={filters} error={error} action="/ads" title={t('text001')} policy={policy} />; }
  const accountSummaries = summarizeInsights(dataset.insights, 'account');
  const campaigns = summarizeInsights(dataset.insights, 'campaign');
  const adsets = summarizeInsights(dataset.insights, 'adset');
  const ads = summarizeInsights(dataset.insights, 'ad');
  const accountMetrics = new Map(accountSummaries.map(row => [row.accountId, row]));
  const scopedAccounts = filters.accountId ? dataset.accounts.filter(account => account.id === filters.accountId) : dataset.accounts;
  const accountPage = pageAdsRows(scopedAccounts, requestedPage, dataset.pageSize);
  const visibleAccounts = accountPage.items;
  const enabled = scopedAccounts.filter(account => account.enabled).length;
  const synced = scopedAccounts.filter(account => account.lastSyncedAt).length;
  const canExport = canUseFeature(entitlements, 'ads/campaigns') && canAccessFeature(permissions, 'ads/campaigns', 'read');
  const exportPolicy = canExport ? await loadAdsOutputPolicy().catch(() => null) : null;
  const sidebar = <AdsReportSidebar catalogs={catalogs} locale={locale} accounts={dataset.accounts} filters={filters} action="/ads" kind="accounts" policy={policy} page={accountPage} canExport={canExport} maxRows={dataset.maxRows} exportPolicy={exportPolicy ?? undefined} />;
  return <PageFrame module="ads" sidebar={dataset.accounts.length ? sidebar : undefined}><div className="page-stack">
    <PageHeader module="ads" title={t('text001')} description={<>{dataset.accounts.length ? t('text258', { value0: accountPage.from, value1: accountPage.to, value2: accountPage.resultCount, value3: accountPage.page, value4: accountPage.pageCount, value5: dateRangeLabel(filters) }) : t('text002')}</>} />
    {!dataset.accounts.length ? <EmptyState title={t('text003')} icon={<IconAd />} action={<a className="text-link" href="/settings/connections">{t('text004')}</a>}>{t('text005')}</EmptyState> : <>
    <section className="metric-grid" aria-label={t('text006')}>
      <article className="metric-card"><dl><dt>{t('text007')}</dt><dd>{scopedAccounts.length}</dd></dl></article>
      <article className="metric-card"><dl><dt>{t('text008')}</dt><dd>{enabled}</dd></dl></article>
      <article className="metric-card"><dl><dt>{t('text009')}</dt><dd>{synced}</dd></dl></article>
      <article className="metric-card"><dl><dt>{t('text010')}</dt><dd>{campaigns.length}</dd></dl></article>
    </section>
    <section className="panel"><div className="analytics-panel-title"><div><h2>{t('text011')}</h2><p className="small-note">{t('text012')}</p></div><a className="text-link" href={adsQuery(filters, '/ads/campaigns')}>{t('text013')}</a></div>
      {visibleAccounts.length ? <div className="ads-account-list">{visibleAccounts.map(account => {
        const row = accountMetrics.get(account.id);
        return <article className="ads-account-card" key={account.id}>
          <div className="ads-account-card__heading"><div><Badge tone={account.enabled ? 'success' : 'neutral'}>{account.enabled ? t('text014') : t('text015')}</Badge><h3>{account.name}</h3><p className="small-note">{account.actId}{account.currency ? ` · ${account.currency}` : ''} {t('text016')}{account.accountStatus ?? t('text017')}</p></div><span className="ads-account-card__sync">{account.lastSyncedAt ? t('text259', { value0: account.lastSyncedAt.toLocaleDateString() }) : t('text018')}</span></div>
          {row ? <><AccountCharts row={row} locale={locale} /><div className="ads-metric-strip"><span><small>{t('text019')}</small><strong>{money(row.spend, row.currency)}</strong></span><span><small>{t('text020')}</small><strong>{number.format(row.impressions)}</strong></span><span><small>{t('text021')}</small><strong>{number.format(row.reach)}</strong></span><span><small>{t('text022')}</small><strong>{number.format(row.clicks)}</strong></span><span><small>{t('text023')}</small><strong>{money(row.cpc, row.currency)}</strong></span><span><small>{t('text024')}</small><strong>{money(row.cpm, row.currency)}</strong></span><span><small>{t('text025')}</small><strong>{row.ctr === null ? '—' : `${number.format(row.ctr)}%`}</strong></span><span><small>{t('text026')}</small><strong>{money(row.cpp, row.currency)}</strong></span><span><small>{t('text027')}</small><strong>{row.frequency === null ? '—' : number.format(row.frequency)}</strong></span></div><details className="ads-stored-details ads-account-details"><summary>{t('text028')}</summary><div className="ads-detail-content"><h4>{t('text029')}</h4>{row.actions.length ? <ul>{row.actions.map(action => <li key={action.name}><span>{action.name}</span><strong>{number.format(action.value)}</strong></li>)}</ul> : <p>{t('text030')}</p>}<h4>{t('text031')}</h4><DailyMetrics rows={row.dailyMetrics} currency={row.currency} /></div></details></> : <p className="empty-note">{t('text032')}</p>}
        </article>;
      })}</div> : <div className="empty-state"><h3>{t('text033')}</h3><p>{t('text034')}</p></div>}
    </section>
    <section className="panel"><div className="analytics-panel-title"><div><h2>{t('text035')}</h2><p className="small-note">{t('text036')}</p></div></div>
      {dataset.insights.some(row => ['campaign', 'adset', 'ad'].includes(row.level)) ? <div className="report-list">{[
        { label: t('text057'), rows: campaigns }, { label: t('text058'), rows: adsets }, { label: t('text059'), rows: ads },
      ].map(section => <div className="ads-level-row" key={section.label}><span>{section.label}<small>{section.rows.length} {t('text037')}</small></span><a className="text-link" href={adsQuery(filters, '/ads/campaigns')}>{t('text038')}</a></div>)}</div> : <p className="empty-note">{t('text039')}</p>}
      <p className="ads-read-only-note">{t('text040')}</p>
    </section>
    </>}
  </div></PageFrame>;
}

export default async function AdsCopyScreen(props: Parameters<typeof AdsPage>[0]) {
  const catalogs = await loadAdsCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <AdsCopyProvider catalogs={catalogs} locale={locale}>{await AdsPage(props)}</AdsCopyProvider>;
}
