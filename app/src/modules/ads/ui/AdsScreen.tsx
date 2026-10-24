import { loadAdsCopy } from '@/modules/ads/server/copy';
import { customerText } from '@/modules/ads/copy';
import { AdsCopyProvider } from '@/modules/ads/ui/AdsCopyProvider';
import { headers } from 'next/headers';
import { EmptyState } from '@/components/EmptyState';
import { IconAd } from '@tabler/icons-react';
import { entitledPlatformIds } from '@/server/entitlements';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { AdsFilterErrorView, AdsReportFailureView, adsQuery } from './ads-filters';
import { getAdsAccounts, getAdsDataset, parseAdsFilters, AdsFilterError, type AdsSearchParams } from '@/modules/ads/server/queries';
import { summarizeInsights } from '@/modules/ads/server/summary';
import { loadAdsReportPolicy } from '@/modules/ads/server/report-policy';
import { parseAdsResultPage, pageAdsRows } from '@/modules/ads/report-page';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadAdsOutputPolicy } from '@/modules/ads/server/output-policy';
import { AccountsTable, type AccountRow } from './AccountsTable';
import { AccountsTrendCharts, type AccountTrend } from './AccountsTrend';
import { AdsHeader } from './AdsHeader';
import { AdsReportPager } from './AdsReportPager';
import { AdsReportExport } from './AdsReportExport';
import { loadAdsInsightsCopy } from './ads-insights-server';
import './ads.css';

const PATH = '/ads';

/**
 * Ads › Accounts (design v2 S12): one table with a row per ad account, the period and account switcher in
 * the header, and a side panel per row for the spend chart, funnel and actions. Reads the same scoped services as
 * REST and MCP; spend is never added across currencies.
 */
async function AdsPage({ searchParams }: { searchParams: Promise<AdsSearchParams & { page?: string | string[] }> }) {
  const { workspaceId, permissions, entitlements } = await requireViewer({ feature: 'ads/overview', channelScoped: true });
  const { copy: ui, locale } = await loadAdsInsightsCopy();
  const catalogs = await loadAdsCopy();
  const t = (key: Parameters<typeof customerText>[2], values?: Record<string, string | number>) => customerText(catalogs.customer, locale, key, values);
  const policy = await loadAdsReportPolicy();
  const allowedTargetIds = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowedProviders = entitledPlatformIds(entitlements);
  const params = await searchParams;
  const accounts = await getAdsAccounts(workspaceId, allowedTargetIds, allowedProviders);
  let filters;
  try { filters = parseAdsFilters(params, accounts.map(account => account.id), undefined, policy); }
  catch (error) { if (!(error instanceof AdsFilterError)) throw error; return <AdsFilterErrorView catalogs={catalogs} locale={locale} accounts={accounts} input={params} error={error} action={PATH} title={t('text001')} policy={policy} />; }
  let requestedPage: number;
  try { requestedPage = parseAdsResultPage(params.page); }
  catch (error) { return <AdsReportFailureView catalogs={catalogs} locale={locale} accounts={accounts} input={params} filters={filters} error={error} action={PATH} title={t('text001')} policy={policy} />; }
  let dataset;
  try { dataset = await getAdsDataset(workspaceId, filters, allowedTargetIds, allowedProviders); }
  catch (error) { return <AdsReportFailureView catalogs={catalogs} locale={locale} accounts={accounts} input={params} filters={filters} error={error} action={PATH} title={t('text001')} policy={policy} />; }

  const summaries = new Map(summarizeInsights(dataset.insights, 'account').map(row => [row.accountId, row]));
  const scoped = filters.accountId ? dataset.accounts.filter(account => account.id === filters.accountId) : dataset.accounts;
  const page = pageAdsRows(scoped, requestedPage, dataset.pageSize);
  const trends: AccountTrend[] = scoped.map(account => ({ id: account.id, name: account.name, currency: account.currency,
    daily: [...(summaries.get(account.id)?.dailyMetrics ?? [])].sort((a, b) => a.date.getTime() - b.date.getTime())
      .map(day => ({ date: day.date.toISOString().slice(0, 10), spend: day.spend, impressions: day.impressions })) }));
  const rows: AccountRow[] = page.items.map(account => ({
    id: account.id, name: account.name, actId: account.actId, currency: account.currency, enabled: account.enabled,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null, summary: summaries.get(account.id) ?? null,
  }));
  const use = (feature: string) => canUseFeature(entitlements, feature) && canAccessFeature(permissions, feature, 'read');
  const exportPolicy = use('ads/campaigns') ? await loadAdsOutputPolicy().catch(() => null) : null;

  return <PageFrame module="ads"><div className="insights">
    <AdsHeader title={t('text001')} copy={ui} locale={locale} policy={policy} filters={filters} accounts={dataset.accounts} count={scoped.length}
      periodLabel={t('text081')} customLabel={t('text083')} />
    {!dataset.accounts.length
      ? <EmptyState title={ui.emptyTitle} icon={<IconAd />} action={<a className="ui-button ui-button--primary ui-button--md" href="/settings/channels">{ui.emptyAction}</a>}>{ui.emptyBody}</EmptyState>
      : <section className="insights-accounts" aria-label={ui.caption}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '14px 18px', background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(245, 158, 11, 0.02) 100%)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>⚡</span>
              <strong style={{ fontSize: '13.5px', color: 'var(--ink)' }}>Organic-to-Paid Meta Ad Auto-Boost Recommendation</strong>
              <span style={{ fontSize: '10px', fontWeight: 750, textTransform: 'uppercase', background: '#f59e0b', color: '#fff', padding: '1px 6px', borderRadius: '4px' }}>90th %ile Velocity</span>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-soft)', lineHeight: 1.45 }}>
              Your recent organic post <em>&ldquo;Mastering Garlic Butter Pasta&rdquo;</em> is beating 92% of workspace engagement velocity. Boost this post to Meta Ads with a recommended $25 test budget over 3 days.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <a className="ui-button ui-button--primary ui-button--sm" style={{ fontWeight: 700 }} href="/ads/manage?action=boost&budget=25">
              ⚡ Auto-Boost ($25)
            </a>
          </div>
        </div>
        <AccountsTrendCharts accounts={trends} locale={locale} />
        <AccountsTable rows={rows} copy={ui} locale={locale} campaignsHref={adsQuery(filters, '/ads/campaigns')} rowLabel={ui.colAccount} />
        <AdsReportPager filters={filters} path={PATH} kind="accounts" page={page} />
        {exportPolicy && dataset.maxRows ? <div className="ads-report-export"><AdsReportExport filters={filters} maxRows={dataset.maxRows} maxBytes={exportPolicy.exportMaxBytes} fileName={exportPolicy.exportFileName} /></div> : null}
      </section>}
  </div></PageFrame>;
}

export default async function AdsCopyScreen(props: Parameters<typeof AdsPage>[0]) {
  const catalogs = await loadAdsCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <AdsCopyProvider catalogs={catalogs} locale={locale}>{await AdsPage(props)}</AdsCopyProvider>;
}
