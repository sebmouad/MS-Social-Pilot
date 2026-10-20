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
import { getAdsAccounts, type AdsSearchParams } from '@/modules/ads/server/queries';
import { loadAdsReportPolicy } from '@/modules/ads/server/report-policy';
import { readAdsDirectory } from '@/modules/ads/directory/server';
import { adsDirectoryManagementPort } from '@/modules/ads/directory/management-port';
import { pageSearchRecord } from '@/modules/ads/analysis/query';
import { AdsFiltersSidebar } from '@/modules/ads/ui/ads-filters';
import { ObjectManager } from './ObjectManager';
import { ChangeHistory } from './ChangeHistory';

type Params = AdsSearchParams & { level?: string; q?: string; sort?: string; direction?: string; parentId?: string; offset?: string };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? undefined : value);
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const show = (value: number | null) => (value === null ? 'Unknown' : number.format(value));

export default async function AdsObjectsPage({ searchParams }: { searchParams: Promise<Params> }) {
  ensureAdsManagement();
  const locale = adsLocale((await headers()).get('accept-language'));
  const viewer = await requireViewer({ feature: 'ads/objects', channelScoped: true });
  const params = await searchParams;
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const policy = await loadAdsReportPolicy();
  const accounts = await getAdsAccounts(viewer.workspaceId, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, entitledPlatformIds(viewer.entitlements));
  const hidden = (['period', 'since', 'until', 'account'] as const).map(key => first(params[key]) ? <input key={key} type="hidden" name={key} value={first(params[key])} /> : null);
  const sidebar = <><AdsFiltersSidebar accounts={accounts} input={params} action="/ads/objects" policy={policy} />
    <form noValidate method="get" action="/ads/objects" className="ads-extra-filters" aria-label="Object options">{hidden}
      <label>Show<select name="level" defaultValue={first(params.level) ?? 'campaign'}><option value="campaign">Campaigns</option><option value="adset">Ad sets</option><option value="ad">Ads</option></select></label>
      <label>Search<input name="q" defaultValue={first(params.q) ?? ''} maxLength={policy.maxFilterCharacters} /></label>
      <label>Parent ID<input name="parentId" defaultValue={first(params.parentId) ?? ''} maxLength={100} /></label>
      <label>Sort by<select name="sort" defaultValue={first(params.sort) ?? 'spend'}><option value="spend">Spend</option><option value="impressions">Impressions</option><option value="clicks">Clicks</option><option value="ctr">Click-through rate</option><option value="cpc">Cost per click</option><option value="cpm">Cost per 1,000 views</option><option value="name">Name</option></select></label>
      <label>Order<select name="direction" defaultValue={first(params.direction) ?? 'desc'}><option value="desc">Highest first</option><option value="asc">Lowest first</option></select></label>
      <button type="submit">Apply</button></form></>;
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
    return <PageFrame module="ads" sidebar={sidebar}><div className="page-stack"><PageHeader module="ads" title={"Campaigns, ad sets and ads"} />
      <section className="panel"><RouteNotice error className="ui-error" focusKey={error.message}>{error.message}</RouteNotice></section></div></PageFrame>;
  }
  const managementPort = adsDirectoryManagementPort();
  const history = managementPort ? await managementPort.listChanges(actor).catch(() => null) : null;
  const query = new URLSearchParams(Object.entries(values).flatMap(([key, value]) => (value !== undefined && key !== 'offset' ? [[key, value]] : [])));
  const pageLink = (offset: number) => `/ads/objects?${new URLSearchParams([...query, ['offset', String(offset)]])}`;
  const accountName = new Map(accounts.map(account => [account.id, account.name]));
  return <PageFrame module="ads" sidebar={sidebar}><div className="page-stack">
    <PageHeader module="ads" title={"Campaigns, ad sets and ads"} description={<>{directory.total} result(s) · {directory.range.from} to {directory.range.to}</>} />
    <section className="panel">
      {directory.freshness.status === 'stale' ? <p className="small-note">Stored figures may be out of date.</p> : null}
      <DataTable caption="Ad objects" rows={directory.items} rowKey={row => `${row.accountId}:${row.objectId}`} emptyMessage="No matching objects. Adjust the filters or search." columns={[
        { key: 'name', label: 'Name', render: row => <><strong>{row.name}</strong><br /><span className="small-note">{accountName.get(row.accountId) ?? row.accountName}{row.parentId ? ` · in ${row.parentId}` : ''}</span></> },
        { key: 'spend', label: 'Spend', align: 'end', render: row => `${row.currency ? `${row.currency} ` : ''}${show(row.spend)}` },
        { key: 'impressions', label: 'Impressions', align: 'end', render: row => show(row.impressions) },
        { key: 'clicks', label: 'Clicks', align: 'end', render: row => show(row.clicks) },
        { key: 'last', label: 'Last delivery', render: row => row.lastDeliveryDate ?? 'None in range' },
        { key: 'manage', label: 'Actions', render: row => <ObjectManager adAccountId={row.accountId} level={directory.level} objectId={row.objectId} name={row.name} /> },
      ]} />
      <nav aria-label="Pages">{directory.offset > 0 ? <a href={pageLink(Math.max(0, directory.offset - directory.limit))}>Previous</a> : null}{' '}{directory.nextOffset !== null ? <a href={pageLink(directory.nextOffset)}>Next</a> : null}</nav>
      <p className="small-note">{directory.note}</p>
    </section>
    {history ? <section className="panel" id="changes" aria-labelledby="changes-title"><h2 id="changes-title">Change history</h2><ChangeHistory locale={locale} items={history} /></section> : null}
  </div></PageFrame>;
}
