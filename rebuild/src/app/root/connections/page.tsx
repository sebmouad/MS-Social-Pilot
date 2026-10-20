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
  const controls = <section className="root-ops-sidebar" aria-label={t.filters}>
    <form action="/root/connections" className="root-ops__filters" method="get" role="search" aria-label={t.filters}>
      <label className="ui-field"><span>{t.platform}</span><select className="ui-input" name="provider" defaultValue={value('provider')}><option value="">{t.allPlatforms}</option>{PLATFORM_MODULES.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label>
      <label className="ui-field"><span>{t.state}</span><select className="ui-input" name="state" defaultValue={value('state')}><option value="">{t.allStates}</option><option value="connected">{t.connected}</option><option value="expired">{t.expired}</option><option value="revoked">{t.revoked}</option></select></label>
      <label className="ui-field"><span>{t.search}</span><input className="ui-input" name="q" maxLength={data?.limits.searchMaxCharacters} defaultValue={value('q')} /></label>
      <button className="ui-button" type="submit">{t.filter}</button>
    </form></section>;
  return <RootFrame active="/root/connections" controls={controls}><div className="root-ops" lang={locale}>
    <header className="root-control__heading"><p className="root-config__eyebrow">{t.eyebrow}</p><h1>{t.connectionsTitle}</h1><p>{t.connectionsIntro}</p></header>
    {!data ? <section className="root-control__notice" role="alert"><h2>{t.connectionsUnavailable}</h2><p>{message}</p><a href="/root/connections">{t.reset}</a></section>
      : data.items.length === 0 ? <section className="root-control__panel"><h2>{t.connectionsEmpty}</h2><p>{t.connectionsEmptyHint}</p></section>
      : <>
        <p className="root-activity__summary">{fill(t.total, { count: data.total })}</p>
        <div className="root-ops__table" role="region" aria-label={t.connectionsTitle} tabIndex={0}><table>
          <caption className="ui-visually-hidden">{t.connectionsTitle}</caption>
          <thead><tr><th scope="col">{t.connection}</th><th scope="col">{t.workspace}</th><th scope="col">{t.state}</th><th scope="col">{t.channels}</th><th scope="col">{t.permissions}</th><th scope="col">{t.tokenExpiry}</th><th scope="col">{t.connectionAction}</th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.id}>
            <td><strong>{item.name}</strong><br /><span className="root-ops__muted">{item.platformName}{item.installed ? '' : ` (${t.notInstalled})`}</span></td>
            <td><a href={`/root/workspaces?q=${encodeURIComponent(item.workspace.name)}`}>{item.workspace.name}</a></td>
            <td>{t[item.state]}{item.invalidReason ? <><br /><span className="root-ops__muted">{item.invalidReason}</span></> : null}</td>
            <td>{fill(t.selectedOf, { selected: item.channels.selected, discovered: item.channels.discovered })}</td>
            <td>{fill(t.permissionCount, { count: item.scopeCount })}</td>
            <td>{item.tokenExpiresAt ? <time dateTime={item.tokenExpiresAt}>{new Date(item.tokenExpiresAt).toLocaleString(locale)}</time> : t.never}</td>
            <td><RefreshConnection id={item.id} name={item.name} locale={locale} />{' '}{item.state === 'revoked' ? null : <ConfirmAction id={`disconnect-${item.id}`} label={t.disconnect} title={fill(t.disconnectTitle, { name: item.name })} description={t.disconnectBody} phrase={`DISCONNECT CONNECTION ${item.id}`} endpoint={`/api/root/connections/${encodeURIComponent(item.id)}`} method="POST" body={{}} variant="danger" successText={t.disconnectDone} />}{' '}<DeleteConnectionData id={item.id} name={item.name} locale={locale} /></td>
          </tr>)}</tbody>
        </table></div>
        <p className="root-directory__pager">{fill(t.page, { page: data.page, pages: Math.max(1, Math.ceil(data.total / data.pageSize)) })}
          {data.page > 1 && <> · <a href={pageUrl(data.page - 1)}>{t.previous}</a></>}{data.page * data.pageSize < data.total && <> · <a href={pageUrl(data.page + 1)}>{t.next}</a></>}</p>
      </>}
  </div></RootFrame>;
}
