import { StatusChip } from '@/components/StatusChip';
import { OperationError } from '@/lib/operation-error';
import { requireRootPage } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { RootFrame } from '@/server/root/RootFrame';
import { RootUserFilters } from '@/server/root/RootUserFilters';
import { loadRootUsers } from '@/server/root/users';
import { RootUserControls } from './RootUserControls';
import './root-users.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users · Root' };

type Search = { q?: string | string[]; page?: string | string[]; status?: string | string[] };

export default async function RootUsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireRootPage();
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
    <header className="root-control__heading">
      <p className="root-config__eyebrow">Root · Directory</p>
      <h1>Users</h1>
      <p>Manage installation account access and recovery. API keys do not grant Root access. Account changes are recorded in installation activity.</p>
    </header>
    <RootUserFilters values={params} page={data} searchMaxCharacters={searchMaxCharacters} />
    {data === null ? <section className="root-control__notice" role="alert">
      <h2>{invalid ? 'Check user filters' : 'User directory unavailable'}</h2>
      <p>{invalid ? 'A search, status or page value is invalid. Adjust the filters or reset the directory.' : 'The installation user directory could not be loaded. Try again, or check database availability.'}</p>
      <a href="/root/users">Reset filters</a>
    </section> : <>
      <p className="root-activity__summary">{data.total} {filtered ? 'matching ' : ''}{data.total === 1 ? 'user' : 'users'} · {data.installationTotal} in this installation</p>
      {data.users.length === 0 ? <section className="root-control__panel">
        <h2>{filtered ? 'No users match these filters' : 'No users found'}</h2>
        <p>{filtered ? 'Try another name, email or account status.' : 'There are no user accounts in this installation.'}</p>
      </section> : <>
        <div className="root-directory__table-wrap root-user-table" role="region" aria-label="User directory" tabIndex={0}>
          <table>
            <caption className="ui-visually-hidden">Users in this installation</caption>
            <thead><tr><th scope="col">User</th><th scope="col">Account status</th><th scope="col">Workspaces</th><th scope="col">Active sessions</th><th scope="col">Two-step verification</th><th scope="col">Created</th><th scope="col">Account actions</th></tr></thead>
            <tbody>{data.users.map(user => <tr key={user.id}>
              <td><strong>{user.name}</strong><br /><span>{user.email}</span></td>
              <td><div className="root-user__status"><StatusChip status={user.disabledAt ? 'disabled' : 'active'} />{user.isInstanceOwner && <span className="root-user__owner">Installation owner</span>}</div></td>
              <td>{user._count.memberships}</td>
              <td>{user._count.sessions}</td>
              <td><ul className="root-user__factors" aria-label={`Two-step factors for ${user.email}`}>
                <li>Authenticator: {user.totpEnabledAt ? 'Enabled' : 'Not set up'}</li>
                <li>Passkeys: {user._count.passkeys}</li>
              </ul></td>
              <td><time dateTime={user.createdAt.toISOString()}>{user.createdAt.toLocaleDateString()}</time></td>
              <td><RootUserControls id={user.id} email={user.email} disabled={Boolean(user.disabledAt)} root={user.isInstanceOwner} self={user.id === actor.id} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="root-directory__pager">Page {data.page} of {Math.max(1, Math.ceil(data.total / data.take))}</p>
      </>}
    </>}
  </RootFrame>;
}
