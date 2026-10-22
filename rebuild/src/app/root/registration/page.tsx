import { PageHeader } from '@/components/PageHeader';
import { headers } from 'next/headers';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { listRootRegistration } from '@/server/root/registration-admin';
import { pageSearchParamsObject } from '@/modules/root/server/admin/http';
import { DataTable } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { registrationCopy } from './copy';
import { RegistrationAction } from './RegistrationAction';
import '../plans/root-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Registration / Invitations · Root' };

export default async function RootRegistrationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireRootPage();
  const locale = /^fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const t = registrationCopy[locale];
  let data: Awaited<ReturnType<typeof listRootRegistration>> | null = null;
  let params: Record<string, string> = {};
  try {
    params = pageSearchParamsObject(await searchParams, ['q', 'workspaceId', 'status', 'page', 'accountsPage']);
    data = await listRootRegistration(actor.id, params);
  } catch { /* No partial lists or fabricated configuration state. */ }
  const date = (value: Date | null) => value ? <time dateTime={value.toISOString()}>{value.toLocaleString(locale, { timeZone: 'UTC' })} UTC</time> : t.unavailable;
  const filtersControl = <section className="root-ops-sidebar"><form action="/root/registration" method="get" className="root-ops__filters" role="search" aria-label={t.title}>
    <label className="ui-field"><span>{t.search}</span><input className="ui-input" name="q" defaultValue={params.q} maxLength={data?.searchMaxCharacters} /></label>
    <label className="ui-field"><span>{t.workspace}</span><input className="ui-input" name="workspaceId" defaultValue={params.workspaceId} maxLength={255} /></label>
    <label className="ui-field"><span>{t.status}</span><select className="ui-input" name="status" defaultValue={params.status ?? ''}><option value="">{t.all}</option>{(['pending', 'expired', 'accepted'] as const).map(s => <option key={s} value={s}>{t[s]}</option>)}</select></label>
    <Button type="submit">{t.filter}</Button>
  </form></section>;
  const paging = (kind: 'page' | 'accountsPage', page: number, more: boolean) => {
    const link = (next: number) => { const values = new URLSearchParams(params); values.set(kind, String(next)); return `/root/registration?${values}`; };
    return <nav aria-label={`${kind === 'page' ? t.invitations : t.accounts} · ${t.page} ${page}`} className="root-ops__actions">
      <span>{t.page} {page}</span>{page > 1 && <a href={link(page - 1)}>{t.previous}</a>}{more && <a href={link(page + 1)}>{t.next}</a>}
    </nav>;
  };
  const controls = <>{filtersControl}{data && <section className="root-ops-sidebar">{paging('page', data.page, data.moreInvitations)}{paging('accountsPage', data.accountsPage, data.moreAccounts)}</section>}</>;
  return <RootFrame active="/root/registration" controls={controls}><div className="root-ops" lang={locale}>
    <PageHeader module="root" title={t.title} description={<>{t.intro}</>} />
    <section className="root-ops__panel"><h2>{t.registration}</h2><p>{data ? data.openRegistration ? t.enabled : t.disabled : t.unavailable}</p><a href="/root/config?search=auth.openRegistration">{t.config}</a></section>
    {!data ? <section className="root-ops__panel" role="alert"><p>{t.loadFailed}</p><a href="/root/registration">{t.retry}</a></section> : <>
      <section className="root-ops__panel"><h2>{t.invitations}</h2><DataTable rows={data.invitations} rowKey={row => row.id} caption={t.invitations} emptyMessage={t.emptyInvitations} columns={[
        { key: 'email', label: t.email, render: row => row.email },
        { key: 'workspace', label: t.workspaceName, render: row => <>{row.workspaceName}<br /><small>{row.workspaceId}</small></> },
        { key: 'role', label: t.role, render: row => row.role },
        { key: 'status', label: t.status, render: row => t[row.status] },
        { key: 'created', label: t.created, render: row => date(row.createdAt) },
        { key: 'expires', label: t.expires, render: row => date(row.expiresAt) },
        { key: 'accepted', label: t.acceptedAt, render: row => date(row.acceptedAt) },
        { key: 'actions', label: t.actions, render: row => row.status === 'accepted' ? t.accepted : <RegistrationAction id={row.id} email={row.email} action="revoke" workspaceId={row.workspaceId} workspaceName={row.workspaceName} copy={t} /> },
      ]} /></section>
      <section className="root-ops__panel"><h2>{t.accounts}</h2><p>{t.accountHint}</p><DataTable rows={data.accounts} rowKey={row => row.id} caption={t.accounts} emptyMessage={t.emptyAccounts} columns={[
        { key: 'name', label: t.name, render: row => <>{row.name}{row.disabledAt && <><br />{t.disabledAccount}</>}</> },
        { key: 'email', label: t.email, render: row => row.email },
        { key: 'created', label: t.created, render: row => date(row.createdAt) },
        { key: 'actions', label: t.actions, render: row => <div className="root-ops__actions">{!row.disabledAt && data.openRegistration && <RegistrationAction id={row.id} email={row.email} action="resend" copy={t} />}<RegistrationAction id={row.id} email={row.email} action="delete" copy={t} /></div> },
      ]} /></section>
    </>}
  </div></RootFrame>;
}
