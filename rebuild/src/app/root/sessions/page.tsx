import { cookies, headers } from 'next/headers';
import { requireRootPage } from '@/server/config/access';
import { hashLegacySessionToken, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { prisma } from '@/server/data';
import { pageSearchParamsObject } from '@/server/root/legacy/http';
import { RootFrame } from '@/server/root/RootFrame';
import { OperationError } from '@/lib/operation-error';
import { listRootSessions } from '@/server/root/legacy/sessions';
import { fill, rootCopy, rootCopyLocale } from '@/server/root/legacy/copy';
import { SignOutSession } from './SignOutSession';
import '../plans/legacy-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sessions · Root' };

async function currentSessionId() {
  const token = (await cookies()).get(LEGACY_SESSION_COOKIE)?.value;
  const tokenHash = token ? hashLegacySessionToken(token) : null;
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
  const controls = <section className="root-ops-sidebar" aria-label={t.filters}>
    <form action="/root/sessions" className="root-ops__filters" method="get" role="search" aria-label={t.filters}>
      <label className="ui-field"><span>{t.search}</span><input className="ui-input" name="q" maxLength={data?.limits.searchMaxCharacters} defaultValue={typeof params.q === 'string' ? params.q : ''} /></label>
      <button className="ui-button" type="submit">{t.filter}</button>
    </form></section>;
  return <RootFrame active="/root/sessions" controls={controls}><div className="root-ops" lang={locale}>
    <header className="root-control__heading"><p className="root-config__eyebrow">{t.eyebrow}</p><h1>{t.sessionsTitle}</h1><p>{t.sessionsIntro}</p></header>
    {!data ? <section className="root-control__notice" role="alert"><h2>{t.sessionsUnavailable}</h2><p>{message}</p><a href="/root/sessions">{t.reset}</a></section>
      : data.items.length === 0 ? <section className="root-control__panel"><h2>{t.sessionsEmpty}</h2><p>{t.sessionsEmptyHint}</p></section>
      : <>
        {data.truncated && <p className="root-activity__summary" role="status">{fill(t.truncated, { count: data.limit })}</p>}
        <div className="root-ops__table" role="region" aria-label={t.sessionsTitle} tabIndex={0}><table>
          <caption className="ui-visually-hidden">{t.sessionsTitle}</caption>
          <thead><tr><th scope="col">{t.account}</th><th scope="col">{t.status}</th><th scope="col">{t.expires}</th><th scope="col">{t.action}</th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.id}>
            <td><strong>{item.user.name}</strong><br /><span className="root-ops__muted">{item.user.email}</span>{item.user.installationOwner ? <><br />{t.owner}</> : null}</td>
            <td>{item.verified ? t.verified : t.pending}{item.user.disabled ? <><br />{t.disabledAccount}</> : null}{item.current ? <><br /><strong>{t.thisBrowser}</strong></> : null}</td>
            <td><time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString(locale)}</time></td>
            <td><SignOutSession id={item.id} copy={t} /></td>
          </tr>)}</tbody>
        </table></div>
      </>}
  </div></RootFrame>;
}
