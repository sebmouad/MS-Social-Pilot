import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { loadRootLifecycle } from '@/modules/root/server/admin/lifecycle';
import { DeleteUser, DeleteWorkspace, EnableUser, RestoreWorkspace } from './AccessControls';
import { TransferOwnership } from './TransferOwnership';
import '../plans/root-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lifecycle · Root' };

export default async function RootLifecyclePage() {
  const actor = await requireRootPage();
  const data = await loadRootLifecycle(actor.id).catch(() => null);
  const deleting = new Set(data?.pendingDeletions.map(item => item.workspaceId));
  return <RootFrame active="/root/lifecycle"><div className="root-ops">
    <PageHeader module="root" title="Account and workspace lifecycle" description={<>Review disabled accounts and suspended workspaces, restore access, or transfer workspace ownership. Disable and suspend actions live in <a href="/root/users">Users</a> and <a href="/root/workspaces">Workspaces</a>. Disabled accounts and suspended workspaces can be permanently deleted here.</>} />
    {!data ? <section className="root-control__notice" role="alert"><h2>Lifecycle unavailable</h2><p>Lifecycle state could not be loaded. Check database availability and try again.</p></section> : <>
      <section className="root-ops__panel" aria-labelledby="disabled-users"><h2 id="disabled-users">Disabled accounts</h2>
        {data.disabledUsers.length === 0 ? <p className="root-ops__muted">No accounts are disabled.</p> : <DataTable caption={'Disabled accounts'} rows={data.disabledUsers} rowKey={user => user.id} columns={[
          { key: 'column0', label: 'Account', render: (user) => <><strong>{user.name}</strong><br />{user.email}</> },
          { key: 'column1', label: 'Disabled', render: (user) => <><time dateTime={user.disabledAt}>{new Date(user.disabledAt).toLocaleString()}</time></> },
          { key: 'column2', label: 'Action', render: (user) => <>{user.id === actor.id ? 'Your account' : <><EnableUser id={user.id} email={user.email} /> <DeleteUser id={user.id} email={user.email} /></>}</> }
        ]} />}
      </section>
      <section className="root-ops__panel" aria-labelledby="suspended"><h2 id="suspended">Suspended workspaces</h2>
        {data.suspendedWorkspaces.length === 0 ? <p className="root-ops__muted">No workspaces are suspended.</p> : <DataTable caption={'Suspended workspaces'} rows={data.suspendedWorkspaces} rowKey={workspace => workspace.id} columns={[
          { key: 'column0', label: 'Workspace', render: (workspace) => <><strong>{workspace.name}</strong><br />{workspace.id}</> },
          { key: 'column1', label: 'Owners', render: (workspace) => <>{workspace.owners.join(', ') || 'None'}</> },
          { key: 'column2', label: 'Suspended', render: (workspace) => <><time dateTime={workspace.suspendedAt}>{new Date(workspace.suspendedAt).toLocaleString()}</time></> },
          { key: 'column3', label: 'Action', render: (workspace) => <><RestoreWorkspace id={workspace.id} name={workspace.name} blocked={deleting.has(workspace.id)} /> <DeleteWorkspace id={workspace.id} name={workspace.name} blocked={deleting.has(workspace.id)} />{deleting.has(workspace.id) && <span className="root-ops__muted"> Data deletion in progress</span>}</> }
        ]} />}
      </section>
      {data.pendingDeletions.length > 0 && <section className="root-ops__panel" aria-labelledby="deletions"><h2 id="deletions">Queued data deletions</h2>
        <ul>{data.pendingDeletions.map(item => <li key={item.workspaceId}>{item.workspaceId}: {item.status}</li>)}</ul></section>}
      <TransferOwnership />
    </>}
  </div></RootFrame>;
}
