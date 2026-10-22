import { RootEmptyState } from '@/server/root/RootEmptyState';
import { RootFilters } from '@/server/root/RootFilters';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { cookies, headers } from 'next/headers';
import { requireRootPage } from '@/server/config/access';
import { hashSessionToken, SESSION_COOKIE } from '@/server/auth';
import { prisma } from '@/server/data';
import { pageSearchParamsObject } from '@/modules/root/server/admin/http';
import { RootFrame } from '@/server/root/RootFrame';
import { OperationError } from '@/lib/operation-error';
import { listRootSessions } from '@/modules/root/server/admin/sessions';
import { fill, rootCopy, rootCopyLocale } from '@/modules/root/server/admin/copy';
import { SignOutSession } from './SignOutSession';
import '../plans/root-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sessions · Root' };

async function currentSessionId() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const tokenHash = token ? hashSessionToken(token) : null;
  if (!tokenHash) return null;
  return (await prisma.session.findUnique({ where: { tokenHash: tokenHash }, select: { id: true } }))?.id ?? null;
}

export default async function RootSessionsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireRootPage();
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const t = rootCopy(locale);
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof listRootSessions>> | null = null;
  let message: string | null = null;
  try { data = await listRootSessions(actor.id, pageSearchParamsObject(params, ['q']), undefined, await currentSessionId()); } catch (error) { message = error instanceof OperationError ? error.message : t.loadFailed; }
  const controls = <RootFilters title={t.filters} route="/root/sessions" filters={Object.entries(params).filter(([key, value]) => key !== 'page' && typeof value === 'string' && value !== '').map(([key, value]) => ({ key, label: key, value: String(value) }))}>
    <form key={JSON.stringify(params)} action="/root/sessions" className="root-ops__filters" method="get" role="search" aria-label={t.filters}>
      <label className="ui-field"><span>{t.search}</span><input className="ui-input" name="q" maxLength={data?.limits.searchMaxCharacters} defaultValue={typeof params.q === 'string' ? params.q : ''} /></label>
      <button className="ui-button" type="submit">{t.filter}</button>
    </form></RootFilters>;
  return <RootFrame active="/root/sessions" controls={controls}><div className="root-ops" lang={locale}>
    <PageHeader module="root" title={t.sessionsTitle} description={<>{t.sessionsIntro}</>} />
    {!data ? <section className="root-control__notice" role="alert"><h2>{t.sessionsUnavailable}</h2><p>{message}</p><a href="/root/sessions">{t.reset}</a></section>
      : data.items.length === 0 ? <RootEmptyState route="/root/sessions" title={t.sessionsEmpty}>{t.sessionsEmptyHint}</RootEmptyState>
      : <>
        {data.truncated && <p className="root-activity__summary" role="status">{fill(t.truncated, { count: data.limit })}</p>}
        <DataTable caption={t.sessionsTitle} rows={data.items} rowKey={item => item.id} columns={[
          { key: 'column0', label: t.account, render: (item) => <><strong>{item.user.name}</strong><br /><span className="root-ops__muted">{item.user.email}</span>{item.user.installationOwner ? <><br />{t.owner}</> : null}</> },
          { key: 'column1', label: t.status, render: (item) => <>{item.verified ? t.verified : t.pending}{item.user.disabled ? <><br />{t.disabledAccount}</> : null}{item.current ? <><br /><strong>{t.thisBrowser}</strong></> : null}</> },
          { key: 'column2', label: t.expires, render: (item) => <><time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString(locale)}</time></> },
          { key: 'column3', label: t.action, render: (item) => <><SignOutSession id={item.id} copy={t} /></> }
        ]} />
      </>}
  </div></RootFrame>;
}
