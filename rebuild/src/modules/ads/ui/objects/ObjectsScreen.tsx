import { loadAdsManagementPolicy } from '@/modules/ads/management/server';
import { localizeAdsMessage } from '@/modules/ads/copy';
import { loadAdsCopy } from '@/modules/ads/server/copy';
import { customerText } from '@/modules/ads/copy';
import { AdsCopyProvider } from '@/modules/ads/ui/AdsCopyProvider';
import { PageHeader } from '@/components/PageHeader';
import { headers } from 'next/headers';
import { adsLocale } from '@/modules/ads/analysis/copy';
import { ensureAdsManagement } from '@/modules/ads/server/management';
import '@/modules/ads/ui/ads.css';
import './objects.css';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { DataTable } from '@/components/DataTable';
import { entitledPlatformIds } from '@/server/entitlements';
import { getAdsAccounts, parseAdsFilters, type AdsFilters, type AdsSearchParams } from '@/modules/ads/server/queries';
import { loadAdsReportPolicy } from '@/modules/ads/server/report-policy';
import { readAdsDirectory } from '@/modules/ads/directory/server';
import { adsDirectoryManagementPort } from '@/modules/ads/directory/management-port';
import { pageSearchRecord } from '@/modules/ads/analysis/query';
import { AdsFiltersSidebar } from '@/modules/ads/ui/ads-filters';
import { ObjectManager } from './ObjectManager';
import { adsHeaderFor, adsTabsFor } from '../AdsTabsFor';
import { Button } from '@/components/Button';
import { ObjectRowLabel } from './ObjectRowLabel';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { ChangeHistory } from './ChangeHistory';

type Params = AdsSearchParams & { level?: string; q?: string; sort?: string; direction?: string; parentId?: string; offset?: string };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? undefined : value);
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });


async function AdsObjectsPage({ searchParams }: { searchParams: Promise<Params> }) {
  ensureAdsManagement();
  const locale = adsLocale((await headers()).get('accept-language'));
  const catalogs = await loadAdsCopy();
  const t = (key: Parameters<typeof customerText>[2], values?: Record<string, string | number>) => customerText(catalogs.customer, locale, key, values);
  const show = (value: number | null) => value === null ? t('text094') : number.format(value);
  const viewer = await requireViewer({ feature: 'ads/objects', channelScoped: true });
  const params = await searchParams;
  const tabs = await adsTabsFor('manage', viewer);
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const policy = await loadAdsReportPolicy();
  const managementPolicy = await loadAdsManagementPolicy();
  const accounts = await getAdsAccounts(viewer.workspaceId, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, entitledPlatformIds(viewer.entitlements));
  const hidden = (['period', 'since', 'until', 'account'] as const).map(key => first(params[key]) ? <input key={key} type="hidden" name={key} value={first(params[key])} /> : null);
  // The shared Ads header carries period and account; a period the header cannot parse falls back to the full filter form.
  let headerFilters: AdsFilters | null = null;
  try { headerFilters = parseAdsFilters(params, accounts.map(account => account.id), undefined, policy); } catch { headerFilters = null; }
  const header = headerFilters
    ? await adsHeaderFor('manage', viewer, { title: t('text261'), locale, policy, filters: headerFilters, accounts, periodLabel: t('text081'), customLabel: t('text083') })
    : <><AdsFiltersSidebar catalogs={catalogs} locale={locale} accounts={accounts} input={params} action="/insights/ads/manage" policy={policy} />{tabs}<PageHeader module="ads" title={t('text261')} /></>;
  const sidebar = <>
    <form noValidate method="get" action="/insights/ads/manage" className="ads-extra-filters" aria-label={t('text055')}>{hidden}
      <label>{t('text056')}<select name="level" defaultValue={first(params.level) ?? 'campaign'}><option value="campaign">{t('text057')}</option><option value="adset">{t('text058')}</option><option value="ad">{t('text059')}</option></select></label>
      <label>{t('text060')}<input name="q" defaultValue={first(params.q) ?? ''} maxLength={policy.maxFilterCharacters} /></label>
      <label>{t('text061')}<input name="parentId" defaultValue={first(params.parentId) ?? ''} maxLength={Math.min(policy.maxFilterCharacters, managementPolicy.parentIdMaxCharacters)} /></label>
      <label>{t('text062')}<select name="sort" defaultValue={first(params.sort) ?? 'spend'}><option value="spend">{t('text019')}</option><option value="impressions">{t('text020')}</option><option value="clicks">{t('text022')}</option><option value="ctr">{t('text063')}</option><option value="cpc">{t('text064')}</option><option value="cpm">{t('text065')}</option><option value="name">{t('text066')}</option></select></label>
      <label>{t('text067')}<select name="direction" defaultValue={first(params.direction) ?? 'desc'}><option value="desc">{t('text068')}</option><option value="asc">{t('text069')}</option></select></label>
      <Button type="submit" size="sm">{t('text070')}</Button></form></>;
  let values: Record<string, string | undefined>;
  let directory;
  try {
    values = pageSearchRecord(params, ['period', 'since', 'until', 'account', 'level', 'parentId', 'q', 'sort', 'direction', 'offset'], policy.maxFilterCharacters);
    directory = await readAdsDirectory(actor, {
      ...(values.period ? { period: values.period } : {}), ...(values.since ? { start: values.since } : {}), ...(values.until ? { end: values.until } : {}),
      ...(values.account && values.account !== 'all' ? { accountId: values.account } : {}),
      ...(values.level ? { level: values.level } : {}), ...(values.parentId ? { parentId: values.parentId } : {}), ...(values.q ? { q: values.q } : {}), ...(values.sort ? { sort: values.sort } : {}), ...(values.direction ? { direction: values.direction } : {}),
      ...(values.offset ? { offset: Number(values.offset) } : {}),
    });
  } catch (error) {
    if (!(error instanceof OperationError)) throw error;
    return <PageFrame module="ads"><div className="insights">{header}{sidebar}
      <section className="panel"><RouteNotice error className="ui-error" focusKey={localizeAdsMessage(catalogs, locale, error.message)}>{localizeAdsMessage(catalogs, locale, error.message)}</RouteNotice></section></div></PageFrame>;
  }
  const managementPort = adsDirectoryManagementPort();
  const instants = await workspaceInstantFormatter(actor.workspaceId, locale);
  const history = managementPort ? await managementPort.listChanges(actor).catch(() => null) : null;
  const query = new URLSearchParams(Object.entries(values).flatMap(([key, value]) => (value !== undefined && key !== 'offset' ? [[key, value]] : [])));
  const pageLink = (offset: number) => `/insights/ads/manage?${new URLSearchParams([...query, ['offset', String(offset)]])}`;
  const accountName = new Map(accounts.map(account => [account.id, account.name]));
  return <PageFrame module="ads"><div className="insights">
    {header}
    {sidebar}
    <p className="small-note">{directory.total} {t('text071')} {directory.range.from} {t('text072')} {directory.range.to}</p>
    <section className="panel">
      {directory.freshness.status === 'stale' ? <p className="small-note">{t('text073')}</p> : null}
      <DataTable caption={t('text074')} rows={directory.items} rowKey={row => `${row.accountId}:${row.objectId}`} emptyMessage={t('text075')} columns={[
        { key: 'name', label: t('text066'), render: row => <ObjectRowLabel adAccountId={row.accountId} level={directory.level} objectId={row.objectId} name={row.name}><span className="small-note">{accountName.get(row.accountId) ?? row.accountName}{row.parentId ? t('inParent', { parent: row.parentId }) : ''}</span></ObjectRowLabel> },
        { key: 'spend', label: t('text019'), align: 'end', render: row => `${row.currency ? `${row.currency} ` : ''}${show(row.spend)}` },
        { key: 'impressions', label: t('text020'), align: 'end', render: row => show(row.impressions) },
        { key: 'clicks', label: t('text022'), align: 'end', render: row => show(row.clicks) },
        { key: 'last', label: t('text262'), render: row => row.lastDeliveryDate ?? t('text171') },
        { key: 'manage', label: t('text264'), render: row => <ObjectManager adAccountId={row.accountId} level={directory.level} objectId={row.objectId} name={row.name} /> },
      ]} />
      <nav aria-label={t('text076')}>{directory.offset > 0 ? <a href={pageLink(Math.max(0, directory.offset - directory.limit))}>{t('text077')}</a> : null}{' '}{directory.nextOffset !== null ? <a href={pageLink(directory.nextOffset)}>{t('text078')}</a> : null}</nav>
      <p className="small-note">{directory.note}</p>
    </section>
    {history ? <section className="panel" id="changes" aria-labelledby="changes-title"><h2 id="changes-title">{t('text079')}</h2><ChangeHistory noteMaxCharacters={managementPolicy.recoveryNoteMaxCharacters} locale={locale} items={history.map(item => labelInstants(item, { createdAt: 'dateTime' }, instants))} /></section> : null}
  </div></PageFrame>;
}

export default async function AdsCopyScreen(props: Parameters<typeof AdsObjectsPage>[0]) {
  const catalogs = await loadAdsCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <AdsCopyProvider catalogs={catalogs} locale={locale}>{await AdsObjectsPage(props)}</AdsCopyProvider>;
}
