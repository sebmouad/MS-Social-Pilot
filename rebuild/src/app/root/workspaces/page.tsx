import { RootFrame } from '@/server/root/RootFrame';
import { listRootWorkspaces } from '@/server/root/directory';
import { runtimeConfig } from '@/server/config/store';
import { requireRootPage } from '@/server/config/access';
import { CreateRootWorkspace, RenameRootWorkspace } from './RootWorkspaceControls';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workspaces · Root' };

export default async function RootWorkspacesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireRootPage();
  const params = await searchParams;
  const [pageSize, defaultTimezone, maxName] = await Promise.all([runtimeConfig('root.directoryPageSize'), runtimeConfig('root.defaultWorkspaceTimezone'), runtimeConfig('root.workspaceNameMaxCharacters')]);
  const data = await listRootWorkspaces(params, pageSize);
  const url = (page: number) => `/root/workspaces?${new URLSearchParams({ ...(data.query ? { q: data.query } : {}), page: String(page) })}`;
  return <RootFrame active="/root/workspaces"><div className="root-directory__head"><div><p className="root-config__eyebrow">Root · Directory</p><h1>Workspaces</h1><p>{data.total} workspaces across this installation.</p></div><form className="root-directory__search" action="/root/workspaces"><label>Search workspaces<input name="q" defaultValue={data.query} placeholder="Name or slug" /></label><button type="submit">Search</button></form></div>
    <CreateRootWorkspace defaultTimezone={defaultTimezone} maxName={maxName} />
    <div className="root-directory__table-wrap"><table><thead><tr><th scope="col">Workspace</th><th scope="col">Timezone</th><th scope="col">Members</th><th scope="col">Channels</th><th scope="col">Posts</th><th scope="col">Ad accounts</th><th scope="col">Data state</th><th scope="col">Action</th></tr></thead><tbody>{data.workspaces.map(workspace => <tr key={workspace.id}><td><strong>{workspace.name}</strong><br />{workspace.slug}</td><td>{workspace.timezone}</td><td>{workspace._count.memberships}</td><td>{workspace._count.targets}</td><td>{workspace._count.posts}</td><td>{workspace._count.adAccounts}</td><td>{workspace.dataPurge?.status ?? 'Active'}</td><td><RenameRootWorkspace id={workspace.id} currentName={workspace.name} maxName={maxName} deleting={Boolean(workspace.dataPurge)} /></td></tr>)}</tbody></table>{!data.workspaces.length && <p className="root-config__empty">No workspaces match this search.</p>}</div>
    <div className="root-directory__pager"><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.take))}</span><span>{data.page > 1 && <a href={url(data.page - 1)}>Previous</a>}{data.page * data.take < data.total && <> · <a href={url(data.page + 1)}>Next</a></>}</span></div>
  </RootFrame>;
}
