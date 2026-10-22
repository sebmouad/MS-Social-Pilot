import { RootEmptyState } from '@/modules/root/ui/RootEmptyState';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { StatusChip } from '@/components/StatusChip';
import { OperationError } from '@/lib/operation-error';
import { requireRootPage } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { RootUserFilters } from '@/modules/root/ui/RootUserFilters';
import { loadRootUsers } from '@/server/root/users';
import { RootUserControls } from './RootUserControls';
import './root-users.css';
import { loadRootDates, loadRootInterfaceCopy, rootText } from '@/modules/root/ui/interface-copy';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users · Root' };

type Search = { q?: string | string[]; page?: string | string[]; status?: string | string[] };

export default async function RootUsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireRootPage();
  const [t, dates] = await Promise.all([loadRootInterfaceCopy(), loadRootDates()]);
  const params = await searchParams;
  let searchMaxCharacters: number | null = null;
  try { searchMaxCharacters = await runtimeConfig('root.userSearchMaxCharacters'); } catch { /* The safe directory result may still be available. */ }
  let data: Awaited<ReturnType<typeof loadRootUsers>> | null = null;
  let invalid = false;
  try {
    data = await loadRootUsers(actor.id, params);
  } catch (error) {
    invalid = error instanceof OperationError && error.code === 'invalid_request';
  }

  const filtered = Boolean(params.q || params.status && params.status !== 'all');
  return <RootFrame active="/root/users">
    <PageHeader module="root" title="Users" description={<>Manage installation account access and recovery. API keys do not grant Root access. Account changes are recorded in installation activity.</>} />
    {await RootUserFilters({ values: params, page: data, searchMaxCharacters })}
    {data === null ? <section className="root-control__notice" role="alert">
      <h2>{invalid ? 'Check user filters' : 'User directory unavailable'}</h2>
      <p>{invalid ? 'A search, status or page value is invalid. Adjust the filters or reset the directory.' : 'The installation user directory could not be loaded. Try again, or check database availability.'}</p>
      <a href="/root/users">Reset filters</a>
    </section> : <>
      <p className="root-activity__summary">{data.total} {filtered ? 'matching ' : ''}{data.total === 1 ? 'user' : 'users'} · {data.installationTotal} in this installation</p>
      {data.users.length === 0 ? <RootEmptyState route="/root/users" title={filtered ? 'No users match these filters' : 'No users found'}>{filtered ? 'Try another name, email or account status.' : 'There are no user accounts in this installation.'}</RootEmptyState> : <>
        <DataTable caption="User directory" rows={data.users} rowKey={user => user.id} columns={[
        { key: 'column0', label: t.colUser, render: user => <><strong>{user.name}</strong><br /><span>{user.email}</span></> },
        { key: 'column1', label: t.colAccountStatus, render: user => <><div className="root-user__status"><StatusChip status={user.disabledAt ? 'disabled' : 'active'} />{user.isInstanceOwner && <span className="root-user__owner">{t.valueInstallationOwner}</span>}</div></> },
        { key: 'column2', label: t.workspaces, render: user => <>{user._count.memberships}</> },
        { key: 'column3', label: t.colActiveSessions, render: user => <>{user._count.sessions}</> },
        { key: 'column4', label: t.colTwoStep, render: user => <><ul className="root-user__factors" aria-label={rootText(t.valueTwoStepFactors, { email: user.email })}>
                <li>{rootText(t.valueAuthenticator, { state: user.totpEnabledAt ? t.valueEnabled : t.valueNotSetUp })}</li>
                <li>{rootText(t.valuePasskeys, { count: user._count.passkeys })}</li>
              </ul></> },
        { key: 'column5', label: t.colCreated, render: user => <><time dateTime={user.createdAt.toISOString()}>{dates.date(user.createdAt)}</time></> },
        { key: 'column6', label: t.colAccountActions, render: user => <><RootUserControls id={user.id} email={user.email} disabled={Boolean(user.disabledAt)} root={user.isInstanceOwner} self={user.id === actor.id} /></> }
      ]} />
        <p className="root-directory__pager">{rootText(t.userPageOf, { page: data.page, total: Math.max(1, Math.ceil(data.total / data.take)) })}</p>
      </>}
    </>}
  </RootFrame>;
}
