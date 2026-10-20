import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { RootFrame } from '@/server/root/RootFrame';
import { listRootWorkspaces } from '@/server/root/directory';
import { runtimeConfig } from '@/server/config/store';
import { requireRootPage } from '@/server/config/access';
import { CreateRootWorkspace, RenameRootWorkspace } from './RootWorkspaceControls';
import { WorkspaceAccessControl } from './WorkspaceAccessControl';
import { RootDirectorySearch } from '@/server/root/RootDirectorySearch';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workspaces · Root' };

export default async function RootWorkspacesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireRootPage();
  const params = await searchParams;
  const [pageSize, defaultTimezone, maxName] = await Promise.all([runtimeConfig('root.directoryPageSize'), runtimeConfig('root.defaultWorkspaceTimezone'), runtimeConfig('root.workspaceNameMaxCharacters')]);
  const data = await listRootWorkspaces(params, pageSize);
  const url = (page: number) => `/root/workspaces?${new URLSearchParams({ ...(data.query ? { q: data.query } : {}), page: String(page) })}`;
  return <RootFrame active="/root/workspaces"><PageHeader module="root" title="Workspaces" description={<>{data.total} {data.query ? 'matching workspaces' : 'workspaces across this installation'}.</>} /><RootDirectorySearch kind="workspaces" query={data.query} />
    <CreateRootWorkspace defaultTimezone={defaultTimezone} maxName={maxName} />
    <DataTable caption={'Workspaces in this installation'} rows={data.workspaces} rowKey={workspace => workspace.id} emptyMessage="No workspaces match this search." emptyAction={<a href="/root/workspaces">Reset search</a>} columns={[
          { key: 'column0', label: 'Workspace', render: (workspace) => <><strong>{workspace.name}</strong><br />{workspace.slug}</> },
          { key: 'column1', label: 'Timezone', render: (workspace) => <>{workspace.timezone}</> },
          { key: 'column2', label: 'Access', render: (workspace) => <>{workspace.suspendedAt ? 'Suspended' : 'Active'}</> },
          { key: 'column3', label: 'Members', render: (workspace) => <>{workspace._count.memberships}</> },
          { key: 'column4', label: 'Channels', render: (workspace) => <>{workspace._count.targets}</> },
          { key: 'column5', label: 'Posts', render: (workspace) => <>{workspace._count.posts}</> },
          { key: 'column6', label: 'Ad accounts', render: (workspace) => <>{workspace._count.adAccounts}</> },
          { key: 'column7', label: 'Data state', render: (workspace) => <>{workspace.dataPurge?.status ?? 'No deletion queued'}</> },
          { key: 'column8', label: 'Action', render: (workspace) => <><div className="root-directory__workspace-actions"><RenameRootWorkspace id={workspace.id} currentName={workspace.name} maxName={maxName} deleting={Boolean(workspace.dataPurge)} /><WorkspaceAccessControl id={workspace.id} name={workspace.name} suspended={Boolean(workspace.suspendedAt)} deleting={Boolean(workspace.dataPurge && workspace.dataPurge.status !== 'completed')} /></div></> }
        ]} />
    <div className="root-directory__pager"><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.take))}</span><span>{data.page > 1 && <a href={url(data.page - 1)}>Previous</a>}{data.page * data.take < data.total && <> · <a href={url(data.page + 1)}>Next</a></>}</span></div>
  </RootFrame>;
}
