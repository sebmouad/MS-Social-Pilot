import { headers } from 'next/headers';
import { AgencyExport } from './AgencyExport';
import { agencyExportLocale } from '../export-copy';
import { requireViewer } from '@/server/context';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { AGENCY_SORTS, type AgencyGroup, type AgencyTotals, type AgencyWorkspace } from '@/modules/agency/agency';
import { agencyOverview, agencySearchLimit } from '@/modules/agency/server/agency';
import { AgencyFilters } from './AgencyFilters';
import { AgencyHeading, AgencyShell } from './AgencyChrome';
import { WorkspaceAction } from './WorkspaceAction';
import styles from './agency.module.css';

const KEYS = ['q', 'sort', 'order', 'attention'];
const WITHHELD = 'Not shown for workspaces where you lack access to this data';

function Status({ item }: { item: AgencyWorkspace }) {
  if (item.state === 'suspended') return <span className={styles.flag} data-tone="warn">Suspended</span>;
  if (item.state === 'deleting') return <span className={styles.flag} data-tone="warn">Data deletion in progress</span>;
  const metrics = item.metrics;
  return <>
    {item.needsAttention ? <span className={styles.flag} data-tone="warn">Needs attention</span> : <span className={styles.flag} data-tone="ok">Healthy</span>}
    {metrics && (metrics.disconnected ?? 0) > 0 && <span className={styles.meta}>{metrics.disconnected} of {metrics.channels} channels cannot publish</span>}
    {metrics && (metrics.failed ?? 0) > 0 && <span className={styles.meta}>{metrics.failed} failed posts</span>}
    {metrics && (metrics.overdueTasks ?? 0) > 0 && <span className={styles.meta}>{metrics.overdueTasks} overdue tasks</span>}
  </>;
}

function Actions({ item }: { item: AgencyWorkspace }) {
  if (item.state !== 'available' || !item.metrics) return <span className={styles.meta}>Unavailable until the workspace is active</span>;
  const { metrics } = item;
  return <div className={styles.actions}>
    <WorkspaceAction workspaceId={item.id} workspaceName={item.name} href="/home" label="Open" variant={item.needsAttention ? 'secondary' : 'primary'} />
    {(metrics.disconnected ?? 0) > 0 && <WorkspaceAction workspaceId={item.id} workspaceName={item.name} href="/settings/connections" label="Fix connections" variant="primary" />}
    {(metrics.failed ?? 0) > 0 && <WorkspaceAction workspaceId={item.id} workspaceName={item.name} href="/publishing/posts" label="Review posts" variant="primary" />}
    {(metrics.overdueTasks ?? 0) > 0 && <WorkspaceAction workspaceId={item.id} workspaceName={item.name} href="/tasks?overdue=true" label="Overdue tasks" variant="primary" />}
  </div>;
}

/** A cell for one count: a withheld value is a dash with an explanation, never a zero. */
const Cell = ({ value }: { value: number | null | undefined }) =>
  <td className={styles.num}>{value === undefined ? '–' : value === null ? <span title={WITHHELD}>–<span className="sr-only"> {WITHHELD}</span></span> : value}</td>;

/** Tells the reader when a total leaves out workspaces whose data this person cannot read. */
function Coverage({ totals, group }: { totals: AgencyTotals; group: AgencyGroup }) {
  const { covered, of } = totals.coverage[group];
  return covered < of ? <span className={styles.meta}>Counted in {covered} of {of} workspaces</span> : null;
}

export default async function AgencyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Person-wide page: the selected workspace's role must not decide access; the service checks every membership.
  const viewer = await requireViewer({ channelScoped: true });
  const params = await searchParams;
  const bad = Object.entries(params).some(([key, value]) => !KEYS.includes(key) || typeof value !== 'string')
    || (params.sort !== undefined && !(AGENCY_SORTS as readonly string[]).includes(String(params.sort)))
    || (params.order !== undefined && params.order !== 'asc' && params.order !== 'desc')
    || (params.attention !== undefined && params.attention !== 'true');
  if (bad) return <AgencyShell><AgencyHeading description="Review your filters." /><RouteNotice error focusKey="agency-filter-error">Choose valid filters and try again.</RouteNotice><a href="/agency">Reset filters</a></AgencyShell>;
  const filters = { q: String(params.q ?? ''), sort: String(params.sort ?? 'attention'), order: String(params.order ?? 'desc'), attention: params.attention === 'true' };
  try {
    const searchLimit = await agencySearchLimit();
    const result = await agencyOverview({ userId: viewer.user.id }, { ...(filters.q ? { q: filters.q } : {}), sort: filters.sort, order: filters.order, attentionOnly: filters.attention });
    const locale = agencyExportLocale((await headers()).get('accept-language'));
    const exportQuery = new URLSearchParams({ q: filters.q, sort: filters.sort, order: filters.order, attention: String(filters.attention) }).toString();
    const totals = result.totals;
    const scope = result.filtered ? `${totals.workspaces} matching ${totals.workspaces === 1 ? 'workspace' : 'workspaces'}` : 'your workspaces';
    const count = (value: number | null) => value === null ? '–' : value;
    return <AgencyShell>
      <AgencyHeading description={`Compare the workspaces you own or administer. Failed posts cover the last ${result.windowDays} days.`} />
      <AgencyFilters values={filters} searchLimit={searchLimit} />
      <AgencyExport key={`${locale}:${exportQuery}`} query={exportQuery} locale={locale} />
      {result.truncated && <RouteNotice focusKey="agency-truncated">
        {(result.filtered ? `More than ${result.limit} workspaces match this search; only the first ${result.limit} by name are shown. Search for more of the name to narrow them.`
          : `You manage more than ${result.limit} workspaces; only the first ${result.limit} by name are shown. Search by name to find another workspace.`)
          + (filters.attention ? ` The needs-attention filter only looked at those ${result.limit}.` : '')}
      </RouteNotice>}
      {totals.workspaces > 0 && <dl className={styles.tiles} aria-label={`Across ${scope}`}>
        <div><dt>{result.filtered ? 'Matching workspaces' : 'Workspaces'}</dt><dd>{totals.workspaces}</dd></div>
        <div data-tone={totals.needingAttention ? 'warn' : undefined}><dt>Need attention</dt><dd>{totals.needingAttention}</dd></div>
        <div data-tone={totals.disconnected ? 'warn' : undefined}><dt>Channels that cannot publish</dt><dd>{count(totals.disconnected)} {totals.channels !== null && <span>of {totals.channels}</span>}<Coverage totals={totals} group="channels" /></dd></div>
        <div data-tone={totals.failed ? 'warn' : undefined}><dt>Failed posts</dt><dd>{count(totals.failed)}<Coverage totals={totals} group="publishing" /></dd></div>
        <div><dt>Scheduled posts</dt><dd>{count(totals.scheduled)}<Coverage totals={totals} group="publishing" /></dd></div>
        <div data-tone={totals.overdueTasks ? 'warn' : undefined}><dt>Overdue tasks</dt><dd>{count(totals.overdueTasks)} {totals.openTasks !== null && <span>of {totals.openTasks} open</span>}<Coverage totals={totals} group="tasks" /></dd></div>
      </dl>}
      {result.workspaces.length === 0
        ? <p className={styles.empty}>{totals.workspaces === 0 && !result.filtered ? 'You do not own or administer any workspace with Agency access yet.'
          : totals.workspaces === 0 ? 'No workspaces match this search.' : 'No workspaces need attention.'} {(result.filtered || filters.attention) && <a href="/agency">Reset filters</a>}</p>
        : <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Workspaces you manage</caption>
            <thead><tr><th scope="col">Workspace</th><th scope="col">Status</th><th scope="col" className={styles.num}>Channels</th><th scope="col" className={styles.num}>Scheduled</th><th scope="col" className={styles.num}>Failed</th><th scope="col" className={styles.num}>Open tasks</th><th scope="col" className={styles.num}>Team</th><th scope="col" className={styles.num}>Clients</th><th scope="col">Actions</th></tr></thead>
            <tbody>{result.workspaces.map(item => <tr key={item.id}>
              <th scope="row"><span className={styles.name}>{item.name}</span><span className={styles.meta}>{item.role === 'owner' ? 'Owner' : 'Admin'}</span></th>
              <td><Status item={item} /></td>
              <Cell value={item.metrics?.channels} /><Cell value={item.metrics?.scheduled} /><Cell value={item.metrics?.failed} />
              <Cell value={item.metrics?.openTasks} /><Cell value={item.metrics?.members} /><Cell value={item.metrics?.clients} />
              <td><Actions item={item} /></td>
            </tr>)}</tbody>
          </table>
        </div>}
    </AgencyShell>;
  } catch (error) {
    return <AgencyShell><AgencyHeading description="Compare the workspaces you manage." /><RouteNotice error focusKey="agency-load-error">{error instanceof OperationError ? error.message : 'Agency data could not be loaded. Refresh and try again.'}</RouteNotice></AgencyShell>;
  }
}
