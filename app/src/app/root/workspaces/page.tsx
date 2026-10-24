import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { listRootWorkspaces } from '@/server/root/directory';
import { runtimeConfig } from '@/server/config/store';
import { requireRootPage } from '@/server/config/access';
import { CreateRootWorkspace, RenameRootWorkspace } from './RootWorkspaceControls';
import { WorkspaceAccessControl } from './WorkspaceAccessControl';
import { RootDirectorySearch } from '@/modules/root/ui/RootDirectorySearch';
import { loadRootDates, loadRootInterfaceCopy, rootText } from '@/modules/root/ui/interface-copy';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workspaces · Root' };

export default async function RootWorkspacesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const actor = await requireRootPage();
  const t = await loadRootInterfaceCopy();
  const params = await searchParams;
  const [defaultTimezone, maxName] = await Promise.all([runtimeConfig('root.defaultWorkspaceTimezone'), runtimeConfig('root.workspaceNameMaxCharacters')]);
  const data = await listRootWorkspaces(actor.id, params);
  const url = (page: number) => `/root/workspaces?${new URLSearchParams({ ...(data.query ? { q: data.query } : {}), page: String(page) })}`;
  return <RootFrame active="/root/workspaces"><PageHeader module="root" title="Workspaces" description={<>{data.total} {data.query ? 'matching workspaces' : 'workspaces across this installation'}.</>} />{await RootDirectorySearch({ kind: 'workspaces', query: data.query })}
    <CreateRootWorkspace defaultTimezone={defaultTimezone} maxName={maxName} />
    <DataTable caption={'Workspaces in this installation'} rows={data.workspaces} rowKey={workspace => workspace.id} emptyMessage="No workspaces match this search." emptyAction={<a href="/root/workspaces">Reset search</a>} columns={[
          { key: 'column0', label: t.colWorkspace, render: (workspace) => <><strong>{workspace.name}</strong><br />{workspace.slug}</> },
          { key: 'column1', label: t.colTimezone, render: (workspace) => <>{workspace.timezone}</> },
          { key: 'column2', label: t.colAccess, render: (workspace) => <>{workspace.suspendedAt ? t.valueSuspendedState : t.valueActive}</> },
          { key: 'column3', label: t.colMembers, render: (workspace) => <>{workspace._count.memberships}</> },
          { key: 'column4', label: t.colChannels, render: (workspace) => <>{workspace._count.targets}</> },
          { key: 'column5', label: t.colPosts, render: (workspace) => <>{workspace._count.posts}</> },
          { key: 'column6', label: t.colAdAccounts, render: (workspace) => <>{workspace._count.adAccounts}</> },
          { key: 'column7', label: t.colDataState, render: (workspace) => <>{workspace.dataPurge?.status ?? t.valueNoDeletion}</> },
          { key: 'column8', label: t.colAction, render: (workspace) => <><div className="root-directory__workspace-actions"><RenameRootWorkspace id={workspace.id} currentName={workspace.name} maxName={maxName} deleting={Boolean(workspace.dataPurge)} /><WorkspaceAccessControl id={workspace.id} name={workspace.name} suspended={Boolean(workspace.suspendedAt)} deleting={Boolean(workspace.dataPurge && workspace.dataPurge.status !== 'completed')} /></div></> }
        ]} />
    <div className="root-directory__pager"><span>{rootText(t.userPageOf, { page: data.page, total: Math.max(1, Math.ceil(data.total / data.take)) })}</span><span>{data.page > 1 && <a href={url(data.page - 1)}>{t.userPrevious}</a>}{data.page * data.take < data.total && <> · <a href={url(data.page + 1)}>{t.userNext}</a></>}</span></div>
  </RootFrame>;
}
