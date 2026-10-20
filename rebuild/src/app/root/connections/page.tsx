import { RootEmptyState } from '@/server/root/RootEmptyState';
import { RootFilters, RootFilterSelect } from '@/server/root/RootFilters';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { RefreshConnection } from './RefreshConnection';
import { DeleteConnectionData } from './DeleteConnectionData';
import { ConfirmAction } from '../plans/ConfirmAction';
import { headers } from 'next/headers';
import { requireRootPage } from '@/server/config/access';
import { pageSearchParamsObject } from '@/server/root/legacy/http';
import { RootFrame } from '@/server/root/RootFrame';
import { OperationError } from '@/lib/operation-error';
import { PLATFORM_MODULES } from '@/platforms';
import { listRootConnections } from '@/server/root/legacy/connections';
import { fill, rootCopy, rootCopyLocale } from '@/server/root/legacy/copy';
import '../plans/legacy-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connections · Root' };
type Search = { q?: string; provider?: string; state?: string; page?: string };

export default async function RootConnectionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireRootPage();
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const t = rootCopy(locale);
  const params = await searchParams;
  let input: Record<string, string> = {};
  let data: Awaited<ReturnType<typeof listRootConnections>> | null = null;
  let message: string | null = null;
  try { input = pageSearchParamsObject(params, ['q', 'provider', 'state', 'page']); data = await listRootConnections(actor.id, input); } catch (error) { message = error instanceof OperationError ? error.message : t.loadFailed; }
  const pageUrl = (page: number) => `/root/connections?${new URLSearchParams({ ...input, page: String(page) })}`;
  const value = (key: keyof Search) => (typeof params[key] === 'string' ? params[key] : '');
  const controls = <RootFilters title={t.filters} route="/root/connections" filters={Object.entries(params).filter(([key, value]) => key !== 'page' && typeof value === 'string' && value !== '').map(([key, value]) => ({ key, label: key, value: String(value) }))}>
    <form key={JSON.stringify(params)} action="/root/connections" className="root-ops__filters" method="get" role="search" aria-label={t.filters}>
      <label className="ui-field"><span>{t.platform}</span><RootFilterSelect name="provider" label={t.platform} initialValue={value('provider')} options={[{ value: '', label: t.allPlatforms }, ...PLATFORM_MODULES.map(module => ({ value: module.id, label: module.name }))]} /></label>
      <label className="ui-field"><span>{t.state}</span><RootFilterSelect name="state" label={t.state} initialValue={value('state')} options={[{ value: '', label: t.allStates }, { value: 'connected', label: t.connected }, { value: 'expired', label: t.expired }, { value: 'revoked', label: t.revoked }]} /></label>
      <label className="ui-field"><span>{t.search}</span><input className="ui-input" name="q" maxLength={data?.limits.searchMaxCharacters} defaultValue={value('q')} /></label>
      <button className="ui-button" type="submit">{t.filter}</button>
    </form></RootFilters>;
  return <RootFrame active="/root/connections" controls={controls}><div className="root-ops" lang={locale}>
    <PageHeader module="root" title={t.connectionsTitle} description={<>{t.connectionsIntro}</>} />
    {!data ? <section className="root-control__notice" role="alert"><h2>{t.connectionsUnavailable}</h2><p>{message}</p><a href="/root/connections">{t.reset}</a></section>
      : data.items.length === 0 ? <RootEmptyState route="/root/connections" title={t.connectionsEmpty}>{t.connectionsEmptyHint}</RootEmptyState>
      : <>
        <p className="root-activity__summary">{fill(t.total, { count: data.total })}</p>
        <DataTable caption={t.connectionsTitle} rows={data.items} rowKey={item => item.id} columns={[
          { key: 'column0', label: t.connection, render: (item) => <><strong>{item.name}</strong><br /><span className="root-ops__muted">{item.platformName}{item.installed ? '' : ` (${t.notInstalled})`}</span></> },
          { key: 'column1', label: t.workspace, render: (item) => <><a href={`/root/workspaces?q=${encodeURIComponent(item.workspace.name)}`}>{item.workspace.name}</a></> },
          { key: 'column2', label: t.state, render: (item) => <>{t[item.state]}{item.invalidReason ? <><br /><span className="root-ops__muted">{item.invalidReason}</span></> : null}</> },
          { key: 'column3', label: t.channels, render: (item) => <>{fill(t.selectedOf, { selected: item.channels.selected, discovered: item.channels.discovered })}</> },
          { key: 'column4', label: t.permissions, render: (item) => <>{fill(t.permissionCount, { count: item.scopeCount })}</> },
          { key: 'column5', label: t.tokenExpiry, render: (item) => <>{item.tokenExpiresAt ? <time dateTime={item.tokenExpiresAt}>{new Date(item.tokenExpiresAt).toLocaleString(locale)}</time> : t.never}</> },
          { key: 'column6', label: t.connectionAction, render: (item) => <><RefreshConnection id={item.id} name={item.name} locale={locale} />{' '}{item.state === 'revoked' ? null : <ConfirmAction id={`disconnect-${item.id}`} label={t.disconnect} title={fill(t.disconnectTitle, { name: item.name })} description={t.disconnectBody} phrase={`DISCONNECT CONNECTION ${item.id}`} endpoint={`/api/root/connections/${encodeURIComponent(item.id)}`} method="POST" body={{}} variant="danger" successText={t.disconnectDone} />}{' '}<DeleteConnectionData id={item.id} name={item.name} locale={locale} /></> }
        ]} />
        <p className="root-directory__pager">{fill(t.page, { page: data.page, pages: Math.max(1, Math.ceil(data.total / data.pageSize)) })}
          {data.page > 1 && <> · <a href={pageUrl(data.page - 1)}>{t.previous}</a></>}{data.page * data.pageSize < data.total && <> · <a href={pageUrl(data.page + 1)}>{t.next}</a></>}</p>
      </>}
  </div></RootFrame>;
}
