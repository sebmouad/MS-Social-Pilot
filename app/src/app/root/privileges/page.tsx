import { RootEmptyState } from '@/modules/root/ui/RootEmptyState';
import { RootFilters, RootFilterSelect } from '@/modules/root/ui/RootFilters';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { requireRootPage } from '@/server/config/access';
import { pageSearchParamsObject } from '@/modules/root/server/admin/http';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { OperationError } from '@/lib/operation-error';
import { listRootPrivileges } from '@/modules/root/server/admin/privileges';
import { CsvExportButton } from '@/components/CsvExportButton';
import { ROOT_PRIVILEGE_CSV_FORMAT, ROOT_PRIVILEGE_CSV_NAME, WORKSPACE_ROLES } from '@/modules/root/server/admin/shared';
import { StatusChip } from '@/components/StatusChip';
import { RoleControl } from './RoleControl';
import '../plans/root-ops.css';
import { loadRootDates, loadRootInterfaceCopy, rootText } from '@/modules/root/ui/interface-copy';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Privileges · Root' };
type Search = { q?: string; role?: string; workspaceId?: string; page?: string };

export default async function RootPrivilegesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireRootPage();
  const t = await loadRootInterfaceCopy();
  const params = await searchParams;
  let input: Record<string, string> = {};
  let data: Awaited<ReturnType<typeof listRootPrivileges>> | null = null;
  let invalid = false;
  try { input = pageSearchParamsObject(params, ['q', 'role', 'workspaceId', 'page']); data = await listRootPrivileges(actor.id, input); } catch (error) { invalid = error instanceof OperationError && error.code === 'invalid_request'; }
  const exportQuery = new URLSearchParams(Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'page'))).toString();
  const pageUrl = (page: number) => `/root/privileges?${new URLSearchParams({ ...input, page: String(page) })}`;
  const controls = <RootFilters title="Privilege filters" route="/root/privileges" filters={Object.entries(params).filter(([key, value]) => key !== 'page' && typeof value === 'string' && value !== '').map(([key, value]) => ({ key, label: key, value: String(value) }))}>    <form key={JSON.stringify(params)} action="/root/privileges" className="root-ops__filters" method="get" role="search" aria-label="Filter privileges">
      <label className="ui-field"><span>Search name, email or workspace</span><input className="ui-input" name="q" defaultValue={typeof params.q === 'string' ? params.q : ''} maxLength={data?.limits.searchMaxCharacters} /></label>
      <label className="ui-field"><span>Role</span><RootFilterSelect name="role" label="Role" initialValue={typeof params.role === 'string' ? params.role : ''} options={[{ value: '', label: 'All roles' }, ...WORKSPACE_ROLES.map(role => ({ value: role, label: role }))]} /></label>
      <button className="ui-button" type="submit">Filter</button>

    </form>
    {data && <CsvExportButton href={`/api/root/privileges/export${exportQuery ? `?${exportQuery}` : ''}`} expectedFormat={ROOT_PRIVILEGE_CSV_FORMAT} rowCountHeader="x-export-rows" maxRows={data.limits.exportMaxRows} maxBytes={data.limits.exportMaxBytes} fileName={ROOT_PRIVILEGE_CSV_NAME} requireFileNameConfirmation copy={{ heading: 'Privilege export', help: 'Download every membership matching these filters. Oversized results are refused.', action: 'Export CSV', pending: 'Preparing CSV…', noun: { singular: 'membership', plural: 'memberships' } }} />}
  </RootFilters>;
  return <RootFrame active="/root/privileges" controls={controls}><div className="root-ops">
    <PageHeader module="root" title="Privileges" description={<>Who holds which role in every workspace and how far their channel access reaches. Workspace roles never grant Root. Role changes need an exact confirmation and are recorded in installation activity.</>} />

    {data === null ? <section className="root-control__notice" role="alert"><h2>{invalid ? 'Check the filters' : 'Privileges unavailable'}</h2><p>{invalid ? 'A search or role value is invalid.' : 'The privilege audit could not be loaded. Try again.'}</p><a href="/root/privileges">Reset filters</a></section>
      : data.items.length === 0 ? <RootEmptyState route="/root/privileges" title="No members match">Try another name, email, workspace or role.</RootEmptyState>
      : <>
        <p className="root-activity__summary">{data.total} {data.total === 1 ? 'membership' : 'memberships'}. The CSV export is limited by Root; oversized exports are refused rather than shortened.</p>
        <DataTable caption={'Members, roles and channel access'} rows={data.items} rowKey={item => item.membershipId} columns={[
          { key: 'column0', label: t.colMember, render: (item) => <><strong>{item.name}</strong><br />{item.email}{item.root ? ` · ${t.valueInstallationOwner}` : ''}</> },
          { key: 'column1', label: t.colWorkspace, render: (item) => <>{item.workspace}{item.workspaceSuspended ? ` · ${t.valueSuspended}` : ''}</> },
          { key: 'column2', label: t.colChannels, render: (item) => <>{item.channels === 'all' ? t.valueAllChannels : rootText(t.valueChannelsSelected, { count: item.channels })}</> },
          { key: 'column3', label: t.colStatus, render: (item) => <><StatusChip status={item.disabled ? 'disabled' : 'active'} /></> },
          { key: 'column4', label: t.colRole, render: (item) => <><RoleControl membershipId={item.membershipId} email={item.email} workspaceId={item.workspaceId} workspace={item.workspace} role={item.role} /></> }
        ]} />
        <p className="root-directory__pager">{rootText(t.userPageOf, { page: data.page, total: Math.max(1, Math.ceil(data.total / data.pageSize)) })}
          {data.page > 1 && <> · <a href={pageUrl(data.page - 1)}>{t.userPrevious}</a></>}{data.page * data.pageSize < data.total && <> · <a href={pageUrl(data.page + 1)}>{t.userNext}</a></>}</p>
      </>}
  </div></RootFrame>;
}
