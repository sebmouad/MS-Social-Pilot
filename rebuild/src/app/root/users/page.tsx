import { RootFrame } from '@/server/root/RootFrame';
import { listRootUsers } from '@/server/root/directory';
import { runtimeConfig } from '@/server/config/store';
import { requireRootPage } from '@/server/config/access';
import { RootUserControls } from './RootUserControls';
import { RootDirectorySearch } from '@/server/root/RootDirectorySearch';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users · Root' };

export default async function RootUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const actor = await requireRootPage();
  const params = await searchParams;
  const data = await listRootUsers(params, await runtimeConfig('root.directoryPageSize'));
  const url = (page: number) => `/root/users?${new URLSearchParams({ ...(data.query ? { q: data.query } : {}), page: String(page) })}`;
  return <RootFrame active="/root/users"><div className="root-directory__head"><div><p className="root-config__eyebrow">Root · Directory</p><h1>Users</h1><p>{data.total} {data.query ? 'matching accounts' : 'accounts'}. Credentials and recovery factors are never displayed here.</p></div><RootDirectorySearch kind="users" query={data.query} /></div>
    <div className="root-directory__table-wrap" role="region" aria-label="User directory table" tabIndex={0}><table><caption className="ui-visually-hidden">Users in this installation</caption><thead><tr><th scope="col">User</th><th scope="col">Access</th><th scope="col">Workspaces</th><th scope="col">Sessions</th><th scope="col">Two-step</th><th scope="col">Created</th><th scope="col">Actions</th></tr></thead><tbody>{data.users.map(user => <tr key={user.id}><td><strong>{user.name}</strong><br />{user.email}</td><td>{user.disabledAt ? 'Disabled' : user.isInstanceOwner ? 'Instance owner' : 'Active'}</td><td>{user._count.memberships}</td><td>{user._count.sessions}</td><td>{user.totpEnabledAt ? 'Authenticator' : user._count.passkeys ? 'Passkey' : 'None'}</td><td>{user.createdAt.toLocaleDateString()}</td><td><RootUserControls id={user.id} email={user.email} disabled={Boolean(user.disabledAt)} root={user.isInstanceOwner} self={user.id === actor.id} /></td></tr>)}</tbody></table></div>{!data.users.length && <p className="root-config__empty">No users match this search.</p>}
    <div className="root-directory__pager"><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.take))}</span><span>{data.page > 1 && <a href={url(data.page - 1)}>Previous</a>}{data.page * data.take < data.total && <> · <a href={url(data.page + 1)}>Next</a></>}</span></div>
  </RootFrame>;
}
