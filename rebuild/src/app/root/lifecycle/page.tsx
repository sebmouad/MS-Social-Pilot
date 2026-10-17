import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { loadRootLifecycle } from '@/server/root/legacy/lifecycle';
import { EnableUser, RestoreWorkspace } from './AccessControls';
import { TransferOwnership } from './TransferOwnership';
import '../plans/legacy-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lifecycle · Root' };

export default async function RootLifecyclePage() {
  const actor = await requireRootPage();
  const data = await loadRootLifecycle(actor.id).catch(() => null);
  const deleting = new Set(data?.pendingDeletions.map(item => item.workspaceId));
  return <RootFrame active="/root/lifecycle"><div className="root-ops">
    <header className="root-control__heading">
      <p className="root-config__eyebrow">Root · Shared controls</p>
      <h1>Account and workspace lifecycle</h1>
      <p>Review disabled accounts and suspended workspaces, restore access, or transfer workspace ownership. Disable and suspend actions live in <a href="/root/users">Users</a> and <a href="/root/workspaces">Workspaces</a>. Deleting accounts or workspaces is not available here.</p>
    </header>
    {!data ? <section className="root-control__notice" role="alert"><h2>Lifecycle unavailable</h2><p>Lifecycle state could not be loaded. Check database availability and try again.</p></section> : <>
      <section className="root-ops__panel" aria-labelledby="disabled-users"><h2 id="disabled-users">Disabled accounts</h2>
        {data.disabledUsers.length === 0 ? <p className="root-ops__muted">No accounts are disabled.</p> : <div className="root-ops__table" role="region" aria-label="Disabled accounts" tabIndex={0}><table>
          <caption className="ui-visually-hidden">Disabled accounts</caption>
          <thead><tr><th scope="col">Account</th><th scope="col">Disabled</th><th scope="col">Action</th></tr></thead>
          <tbody>{data.disabledUsers.map(user => <tr key={user.id}><td><strong>{user.name}</strong><br />{user.email}</td><td><time dateTime={user.disabledAt}>{new Date(user.disabledAt).toLocaleString()}</time></td><td>{user.id === actor.id ? 'Your account' : <EnableUser id={user.id} email={user.email} />}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section className="root-ops__panel" aria-labelledby="suspended"><h2 id="suspended">Suspended workspaces</h2>
        {data.suspendedWorkspaces.length === 0 ? <p className="root-ops__muted">No workspaces are suspended.</p> : <div className="root-ops__table" role="region" aria-label="Suspended workspaces" tabIndex={0}><table>
          <caption className="ui-visually-hidden">Suspended workspaces</caption>
          <thead><tr><th scope="col">Workspace</th><th scope="col">Owners</th><th scope="col">Suspended</th><th scope="col">Action</th></tr></thead>
          <tbody>{data.suspendedWorkspaces.map(workspace => <tr key={workspace.id}><td><strong>{workspace.name}</strong><br />{workspace.id}</td><td>{workspace.owners.join(', ') || 'None'}</td><td><time dateTime={workspace.suspendedAt}>{new Date(workspace.suspendedAt).toLocaleString()}</time></td><td><RestoreWorkspace id={workspace.id} name={workspace.name} blocked={deleting.has(workspace.id)} />{deleting.has(workspace.id) && <span className="root-ops__muted"> Data deletion in progress</span>}</td></tr>)}</tbody>
        </table></div>}
      </section>
      {data.pendingDeletions.length > 0 && <section className="root-ops__panel" aria-labelledby="deletions"><h2 id="deletions">Queued data deletions</h2>
        <ul>{data.pendingDeletions.map(item => <li key={item.workspaceId}>{item.workspaceId}: {item.status}</li>)}</ul></section>}
      <TransferOwnership />
    </>}
  </div></RootFrame>;
}
