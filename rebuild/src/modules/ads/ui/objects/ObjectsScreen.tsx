import { loadAdsManagementPolicy } from '@/modules/ads/management/server';
import { describeAdsManagement } from '@/modules/ads/management/server';
import { localizeAdsMessage } from '@/modules/ads/copy';
import { loadAdsCopy } from '@/modules/ads/server/copy';
import { customerText } from '@/modules/ads/copy';
import { AdsCopyProvider } from '@/modules/ads/ui/AdsCopyProvider';
import { PageHeader } from '@/components/PageHeader';
import { LinkTabs } from '@/components/Tabs';
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
import { loadAdsReadPolicy } from '@/modules/ads/server/read-policy';
import { AdsReportLimitError } from '@/modules/ads/read-policy';
import { listStoredAdObjects } from '@/modules/ads/server/object-store';
import { readAdsDirectory } from '@/modules/ads/directory/server';
import { adsDirectoryManagementPort } from '@/modules/ads/directory/management-port';
import { pageSearchRecord } from '@/modules/ads/analysis/query';
import { AdsFiltersSidebar } from '@/modules/ads/ui/ads-filters';
import { ObjectManager } from './ObjectManager';
import { adsHeaderFor } from '../AdsTabsFor';
import { Button } from '@/components/Button';
import { ObjectRowLabel } from './ObjectRowLabel';
import { adsStatusTone } from './status-tone';
import { Badge } from '@/components/Badge';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { ChangeHistory } from './ChangeHistory';
import { CampaignCreateForm } from '@/modules/ads/ui/CampaignCreateForm';
import { CreativeCreateForm } from '@/modules/ads/ui/CreativeCreateForm';
import { AdSetCreatePicker, AdCreatePicker } from './ManageCreatePickers';
import { CreativesBrowser } from './CreativesBrowser';
import { parseManageLevel, manageTabHref, isManageDirectoryLevel } from './manage-tabs';
import { platformAds } from '@/server/platforms/registry';

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
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const level = parseManageLevel(first(params.level));
  const tabTitle = level === 'campaign' ? t('text057') : level === 'adset' ? t('text058') : level === 'ad' ? t('text059') : t('manageTabCreatives');
  const policy = await loadAdsReportPolicy();
  const managementPolicy = await loadAdsManagementPolicy();
  const accounts = await getAdsAccounts(viewer.workspaceId, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, entitledPlatformIds(viewer.entitlements));
  // Tab links reuse the raw report/search state; paging restarts and legacy sort choices stay valid on load.
  const rawValues: Record<string, string | undefined> = {};
  for (const key of ['period', 'since', 'until', 'account', 'q', 'parentId'] as const) rawValues[key] = first(params[key]);
  const tabs = <LinkTabs label={t('manageTabsLabel')} moreLabel={t('manageMoreTabs')} activeId={level} items={[
    { id: 'campaign', href: manageTabHref(rawValues, 'campaign'), label: t('text057') },
    { id: 'adset', href: manageTabHref(rawValues, 'adset'), label: t('text058') },
    { id: 'ad', href: manageTabHref(rawValues, 'ad'), label: t('text059') },
    { id: 'creative', href: manageTabHref(rawValues, 'creative'), label: t('manageTabCreatives') },
  ]} />;
  const hidden = (['period', 'since', 'until', 'account', 'level', 'sort', 'direction'] as const).map(key => {
    const value = key === 'level' ? level : first(params[key]);
    return value ? <input key={key} type="hidden" name={key} value={value} /> : null;
  });
  // The shared Ads header carries period and account; a period the header cannot parse falls back to the full filter form.
  let headerFilters: AdsFilters | null = null;
  try { headerFilters = parseAdsFilters(params, accounts.map(account => account.id), undefined, policy); } catch { headerFilters = null; }
  const header = headerFilters
    ? await adsHeaderFor({ title: tabTitle, locale, policy, filters: headerFilters, accounts, periodLabel: t('text081'), customLabel: t('text083') })
    : <><AdsFiltersSidebar catalogs={catalogs} locale={locale} accounts={accounts} input={params} action="/ads/manage" policy={policy} /><PageHeader module="ads" title={tabTitle} /></>;
  const sidebar = <>
    <form noValidate method="get" action="/ads/manage" className="ads-extra-filters" aria-label={t('text055')}>{hidden}
      <label>{t('text060')}<input name="q" defaultValue={first(params.q) ?? ''} maxLength={policy.maxFilterCharacters} /></label>
      {level === 'adset' || level === 'ad' ? <label>{t('text061')}<input name="parentId" defaultValue={first(params.parentId) ?? ''} maxLength={Math.min(policy.maxFilterCharacters, managementPolicy.parentIdMaxCharacters)} /></label> : null}
      <Button type="submit" size="sm">{t('text070')}</Button></form></>;
  let values: Record<string, string | undefined>;
  try {
    values = pageSearchRecord(params, ['period', 'since', 'until', 'account', 'level', 'parentId', 'q', 'sort', 'direction', 'offset'], policy.maxFilterCharacters);
  } catch (error) {
    if (!(error instanceof OperationError)) throw error;
    return <PageFrame module="ads"><div className="insights">{header}{tabs}{sidebar}
      <section className="panel"><RouteNotice error className="ui-error" focusKey={localizeAdsMessage(catalogs, locale, error.message)}>{localizeAdsMessage(catalogs, locale, error.message)}</RouteNotice></section></div></PageFrame>;
  }
  const managementPort = adsDirectoryManagementPort();
  const instants = await workspaceInstantFormatter(actor.workspaceId, locale);
  const history = managementPort ? await managementPort.listChanges(actor).catch(() => null) : null;
  const historySection = history ? <section className="panel" id="changes" aria-labelledby="changes-title"><h2 id="changes-title">{t('text079')}</h2><ChangeHistory noteMaxCharacters={managementPolicy.recoveryNoteMaxCharacters} locale={locale} items={history.map(item => labelInstants(item, { createdAt: 'dateTime' }, instants))} /></section> : null;
  const filteredAccounts = !values.account || values.account === 'all' ? accounts : accounts.filter(account => account.id === values.account);

  if (!isManageDirectoryLevel(level)) {
    const managementByAccount = new Map(await Promise.all(filteredAccounts.map(async account => [account.id, await describeAdsManagement(actor, account.id)] as const)));
    const creativeAccounts = filteredAccounts.filter(account => managementByAccount.get(account.id)?.operations.some(op => op.id === 'creative.create'));
    return <PageFrame module="ads"><div className="insights">
      {header}
      {tabs}
      {sidebar}
      <section className="panel"><h2>{t('manageCreativesList')}</h2>
        {filteredAccounts.length ? <CreativesBrowser accounts={filteredAccounts.map(account => ({ id: account.id, name: account.name }))} /> : <p className="small-note">{t('text075')}</p>}
      </section>
      {creativeAccounts.map(account => <section className="panel" key={`creative:${account.id}`}><CreativeCreateForm adAccountId={account.id} accountName={account.name} ownerScope={actor} locale={locale} /></section>)}
      {historySection}
    </div></PageFrame>;
  }

  let directory;
  try {
    directory = await readAdsDirectory(actor, {
      ...(values.period ? { period: values.period } : {}), ...(values.since ? { start: values.since } : {}), ...(values.until ? { end: values.until } : {}),
      ...(values.account && values.account !== 'all' ? { accountId: values.account } : {}),
      level, ...(values.parentId ? { parentId: values.parentId } : {}), ...(values.q ? { q: values.q } : {}),
      sort: values.sort ?? 'name', ...(values.direction ? { direction: values.direction } : {}),
      ...(values.offset ? { offset: Number(values.offset) } : {}),
    });
  } catch (error) {
    if (!(error instanceof OperationError)) throw error;
    return <PageFrame module="ads"><div className="insights">{header}{tabs}{sidebar}
      <section className="panel"><RouteNotice error className="ui-error" focusKey={localizeAdsMessage(catalogs, locale, error.message)}>{localizeAdsMessage(catalogs, locale, error.message)}</RouteNotice></section></div></PageFrame>;
  }
  const query = new URLSearchParams(Object.entries({ ...values, level }).flatMap(([key, value]) => (value !== undefined && key !== 'offset' ? [[key, value]] : [])));
  const pageLink = (offset: number) => `/ads/manage?${new URLSearchParams([...query, ['offset', String(offset)]])}`;
  const accountName = new Map(accounts.map(account => [account.id, account.name]));
  // Parent names and picker choices come from stored inventory only; no provider read runs for this page.
  const readPolicy = await loadAdsReadPolicy();
  const parentLevel = level === 'adset' ? 'campaign' : level === 'ad' ? 'adset' : null;
  const parentInventory = parentLevel ? await listStoredAdObjects(filteredAccounts.map(account => account.id), [parentLevel], readPolicy.maxRows + 1) : [];
  if (parentInventory.length > readPolicy.maxRows) throw new AdsReportLimitError();
  const parentNames = new Map(parentInventory.map(item => [`${item.adAccountId}:${item.objectId}`, item.name ?? item.objectId] as const));
  const parentLabel = level === 'adset' ? t('text156') : t('text157');
  const parentOf = (row: { accountId: string; parentId: string | null }) => row.parentId ? parentNames.get(`${row.accountId}:${row.parentId}`) ?? row.parentId : t('text094');
  const managementByAccount = new Map(await Promise.all(filteredAccounts.map(async account => [account.id, await describeAdsManagement(actor, account.id)] as const)));
  const adsUi = new Map(await Promise.all(filteredAccounts.map(async account => {
    const host = account.socialAccount ? await platformAds(account.socialAccount.provider, locale) : null;
    const ui = host?.creationUi ? await host.creationUi().catch(() => null) : host?.ui ?? null;
    return [account.id, ui] as const;
  })));
  const reconnectNote = (accountId: string, accountLabel: string) => {
    const management = managementByAccount.get(accountId);
    return management && !management.canManage && management.needsReconnect === true
      ? <p className="small-note" role="note">{t('needsReconnectAccount', { account: accountLabel })} <a href="/settings/channels">{t('needsReconnectAction')}</a></p> : null;
  };
  const nameMax = (accountId: string) => {
    const management = managementByAccount.get(accountId);
    return management && 'limits' in management && management.limits ? management.limits.nameMaxCharacters : 100;
  };
  return <PageFrame module="ads"><div className="insights">
    {header}
    {tabs}
    {sidebar}
    <p className="small-note">{directory.total} {t('text071')} {directory.range.from} {t('text072')} {directory.range.to}</p>
    <section className="panel">
      {directory.freshness.status === 'stale' ? <p className="small-note">{t('text073')}</p> : null}
      <DataTable caption={tabTitle} rows={directory.items} rowKey={row => `${row.accountId}:${row.objectId}`} emptyMessage={t('text075')} columns={[
        { key: 'name', label: t('text066'), render: row => <ObjectRowLabel adAccountId={row.accountId} level={directory.level} objectId={row.objectId} name={row.name} status={row.status}><span className="small-note">{accountName.get(row.accountId) ?? row.accountName} · {row.objectId}</span></ObjectRowLabel> },
        ...(parentLevel ? [{ key: 'parent', label: parentLabel, render: (row: (typeof directory.items)[number]) => parentOf(row) }] : []),
        { key: 'status', label: t('manageStatus'), render: row => <Badge tone={adsStatusTone(row.status)}>{row.status ?? t('text094')}</Badge> },
        { key: 'spend', label: t('text019'), align: 'end' as const, render: row => `${row.currency ? `${row.currency} ` : ''}${show(row.spend)}` },
        { key: 'last', label: t('text262'), render: row => row.lastDeliveryDate ?? t('text171') },
        { key: 'updated', label: t('manageSynced'), render: row => row.lastFetchedAt ? row.lastFetchedAt.slice(0, 10) : t('text094') },
        { key: 'manage', label: t('text264'), render: row => <ObjectManager adAccountId={row.accountId} level={directory.level} objectId={row.objectId} name={row.name} /> },
      ]} />
      <nav aria-label={t('text076')}>{directory.offset > 0 ? <a href={pageLink(Math.max(0, directory.offset - directory.limit))}>{t('text077')}</a> : null}{' '}{directory.nextOffset !== null ? <a href={pageLink(directory.nextOffset)}>{t('text078')}</a> : null}</nav>
      <p className="small-note">{directory.note}</p>
    </section>
    {level === 'campaign' && filteredAccounts.some(account => managementByAccount.get(account.id)?.canManage && adsUi.get(account.id)?.campaign) ? <section className="panel"><h2>{t('text052')}</h2><p className="small-note">{t('text053')}</p>
      {filteredAccounts.filter(account => managementByAccount.get(account.id)?.canManage && adsUi.get(account.id)?.campaign).map(account => <CampaignCreateForm key={account.id} adAccountId={account.id} accountName={account.name} config={adsUi.get(account.id)!.campaign!} ownerScope={actor} />)}
    </section> : null}
    {level === 'campaign' ? filteredAccounts.map(account => <div key={`reconnect:${account.id}`}>{reconnectNote(account.id, account.name)}</div>) : null}
    {level === 'adset' ? <section className="panel"><h2>{t('text047')}</h2>
      {viewer.permissions.pageScope.all ? filteredAccounts.filter(account => managementByAccount.get(account.id)?.canManage && adsUi.get(account.id)?.adSet).map(account => <div key={account.id}><h3>{account.name}</h3><AdSetCreatePicker adAccountId={account.id} currency={account.currency} campaigns={parentInventory.filter(item => item.adAccountId === account.id).map(item => ({ id: item.objectId, name: item.name ?? item.objectId }))} config={adsUi.get(account.id)!.adSet!} ownerScope={actor} /></div>) : <p className="small-note">{t('validation027')}</p>}
      {filteredAccounts.map(account => <div key={`reconnect:${account.id}`}>{reconnectNote(account.id, account.name)}</div>)}
    </section> : null}
    {level === 'ad' ? <section className="panel"><h2>{t('adCreateAction')}</h2><p className="small-note">{t('adCreateDescription')}</p>
      {filteredAccounts.filter(account => {
        const management = managementByAccount.get(account.id);
        return viewer.permissions.pageScope.all && management?.canManage && management.canListCreatives && management.operations.some(op => op.id === 'ad.create');
      }).map(account => <div key={account.id}><h3>{account.name}</h3><AdCreatePicker adAccountId={account.id} adSets={parentInventory.filter(item => item.adAccountId === account.id).map(item => ({ id: item.objectId, name: item.name ?? item.objectId }))} nameMaxCharacters={nameMax(account.id)} /></div>)}
      {filteredAccounts.map(account => <div key={`reconnect:${account.id}`}>{reconnectNote(account.id, account.name)}</div>)}
    </section> : null}
    {historySection}
  </div></PageFrame>;
}

export default async function AdsCopyScreen(props: Parameters<typeof AdsObjectsPage>[0]) {
  const catalogs = await loadAdsCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <AdsCopyProvider catalogs={catalogs} locale={locale}>{await AdsObjectsPage(props)}</AdsCopyProvider>;
}
