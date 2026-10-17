import { requireRootPage } from '@/server/config/access';
import { pageSearchParamsObject } from '@/server/root/legacy/http';
import { RootFrame } from '@/server/root/RootFrame';
import { OperationError } from '@/lib/operation-error';
import { listRootPrivileges } from '@/server/root/legacy/privileges';
import { CsvExportButton } from '@/components/CsvExportButton';
import { ROOT_PRIVILEGE_CSV_FORMAT, ROOT_PRIVILEGE_CSV_NAME, WORKSPACE_ROLES } from '@/server/root/legacy/shared';
import { StatusChip } from '@/components/StatusChip';
import { RoleControl } from './RoleControl';
import '../plans/legacy-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Privileges · Root' };
type Search = { q?: string; role?: string; workspaceId?: string; page?: string };

export default async function RootPrivilegesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireRootPage();
  const params = await searchParams;
  let input: Record<string, string> = {};
  let data: Awaited<ReturnType<typeof listRootPrivileges>> | null = null;
  let invalid = false;
  try { input = pageSearchParamsObject(params, ['q', 'role', 'workspaceId', 'page']); data = await listRootPrivileges(actor.id, input); } catch (error) { invalid = error instanceof OperationError && error.code === 'invalid_request'; }
  const exportQuery = new URLSearchParams(Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'page'))).toString();
  const pageUrl = (page: number) => `/root/privileges?${new URLSearchParams({ ...input, page: String(page) })}`;
  const controls = <section className="root-ops-sidebar" aria-label="Privilege filters">    <form action="/root/privileges" className="root-ops__filters" method="get" role="search" aria-label="Filter privileges">
      <label className="ui-field"><span>Search name, email or workspace</span><input className="ui-input" name="q" defaultValue={typeof params.q === 'string' ? params.q : ''} maxLength={data?.limits.searchMaxCharacters} /></label>
      <label className="ui-field"><span>Role</span><select className="ui-input" name="role" defaultValue={typeof params.role === 'string' ? params.role : ''}><option value="">All roles</option>{WORKSPACE_ROLES.map(role => <option key={role} value={role}>{role}</option>)}</select></label>
      <button className="ui-button" type="submit">Filter</button>

    </form>
    {data && <CsvExportButton href={`/api/root/privileges/export${exportQuery ? `?${exportQuery}` : ''}`} expectedFormat={ROOT_PRIVILEGE_CSV_FORMAT} rowCountHeader="x-export-rows" maxRows={data.limits.exportMaxRows} maxBytes={data.limits.exportMaxBytes} fileName={ROOT_PRIVILEGE_CSV_NAME} requireFileNameConfirmation copy={{ heading: 'Privilege export', help: 'Download every membership matching these filters. Oversized results are refused.', action: 'Export CSV', pending: 'Preparing CSV…', noun: { singular: 'membership', plural: 'memberships' } }} />}
  </section>;
  return <RootFrame active="/root/privileges" controls={controls}><div className="root-ops">
    <header className="root-control__heading">
      <p className="root-config__eyebrow">Root · Shared controls</p>
      <h1>Privileges</h1>
      <p>Who holds which role in every workspace and how far their channel access reaches. Workspace roles never grant Root. Role changes need an exact confirmation and are recorded in installation activity.</p>
    </header>

    {data === null ? <section className="root-control__notice" role="alert"><h2>{invalid ? 'Check the filters' : 'Privileges unavailable'}</h2><p>{invalid ? 'A search or role value is invalid.' : 'The privilege audit could not be loaded. Try again.'}</p><a href="/root/privileges">Reset filters</a></section>
      : data.items.length === 0 ? <section className="root-control__panel"><h2>No members match</h2><p>Try another name, email, workspace or role.</p></section>
      : <>
        <p className="root-activity__summary">{data.total} {data.total === 1 ? 'membership' : 'memberships'}. The CSV export is limited by Root; oversized exports are refused rather than shortened.</p>
        <div className="root-ops__table" role="region" aria-label="Privilege audit" tabIndex={0}><table>
          <caption className="ui-visually-hidden">Members, roles and channel access</caption>
          <thead><tr><th scope="col">Member</th><th scope="col">Workspace</th><th scope="col">Channels</th><th scope="col">Status</th><th scope="col">Role</th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.membershipId}>
            <td><strong>{item.name}</strong><br />{item.email}{item.root ? ' · installation owner' : ''}</td>
            <td>{item.workspace}{item.workspaceSuspended ? ' · suspended' : ''}</td>
            <td>{item.channels === 'all' ? 'All channels' : `${item.channels} selected`}</td>
            <td><StatusChip status={item.disabled ? 'disabled' : 'active'} /></td>
            <td><RoleControl membershipId={item.membershipId} email={item.email} workspaceId={item.workspaceId} workspace={item.workspace} role={item.role} /></td>
          </tr>)}</tbody>
        </table></div>
        <p className="root-directory__pager">Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}
          {data.page > 1 && <> · <a href={pageUrl(data.page - 1)}>Previous</a></>}{data.page * data.pageSize < data.total && <> · <a href={pageUrl(data.page + 1)}>Next</a></>}</p>
      </>}
  </div></RootFrame>;
}
