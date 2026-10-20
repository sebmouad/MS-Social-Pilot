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
import { Badge, DataTable, EmptyState, MetricCard } from '@/components';
import { BarChart } from '@/components/charts';
import { IconAlertTriangle, IconCalendar, IconChecklist, IconPlugConnected, IconBuildingCommunity } from '@tabler/icons-react';
import styles from './agency.module.css';

const KEYS = ['q', 'sort', 'order', 'attention'];
const WITHHELD = 'Not shown for workspaces where you lack access to this data';

function Status({ item }: { item: AgencyWorkspace }) {
  if (item.state === 'suspended') return <Badge tone="warning">Suspended</Badge>;
  if (item.state === 'deleting') return <Badge tone="warning">Data deletion in progress</Badge>;
  const metrics = item.metrics;
  return <>
    {item.needsAttention ? <Badge tone="warning">Needs attention</Badge> : <Badge tone="success">Healthy</Badge>}
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
const Cell = ({ value }: { value: number | null | undefined }) => value == null ? <span title={WITHHELD}>–<span className="sr-only"> {WITHHELD}</span></span> : value;

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
      {totals.workspaces > 0 && <div className={styles.metrics} aria-label={`Across ${scope}`}>
        <MetricCard module="agency" icon={<IconBuildingCommunity size={20} />} label={result.filtered ? 'Matching workspaces' : 'Workspaces'} value={totals.workspaces} />
        <MetricCard module="agency" icon={<IconAlertTriangle size={20} />} label="Need attention" value={totals.needingAttention} />
        <MetricCard module="agency" icon={<IconPlugConnected size={20} />} label="Channels that cannot publish" value={count(totals.disconnected)} unavailable={totals.disconnected === null ? WITHHELD : undefined} hint={<>{totals.channels !== null && `of ${totals.channels}`}<Coverage totals={totals} group="channels" /></>} />
        <MetricCard module="agency" icon={<IconAlertTriangle size={20} />} label="Failed posts" value={count(totals.failed)} unavailable={totals.failed === null ? WITHHELD : undefined} hint={<Coverage totals={totals} group="publishing" />} />
        <MetricCard module="agency" icon={<IconCalendar size={20} />} label="Scheduled posts" value={count(totals.scheduled)} unavailable={totals.scheduled === null ? WITHHELD : undefined} hint={<Coverage totals={totals} group="publishing" />} />
        <MetricCard module="agency" icon={<IconChecklist size={20} />} label="Overdue tasks" value={count(totals.overdueTasks)} unavailable={totals.overdueTasks === null ? WITHHELD : undefined} hint={<>{totals.openTasks !== null && `of ${totals.openTasks} open`}<Coverage totals={totals} group="tasks" /></>} />
      </div>}
      {result.workspaces.some(item => item.metrics?.scheduled != null || item.metrics?.failed != null) && <BarChart label="Scheduled posts · Failed posts" locale={locale} categories={result.workspaces.map(item => item.name)} series={[
        { id: 'scheduled', name: 'Scheduled posts', values: result.workspaces.map(item => item.metrics?.scheduled ?? null) },
        { id: 'failed', name: 'Failed posts', values: result.workspaces.map(item => item.metrics?.failed ?? null) },
      ]} orientation="horizontal" />}
      {result.workspaces.length === 0
        ? <EmptyState title={totals.workspaces === 0 && !result.filtered ? 'You do not own or administer any workspace with Agency access yet.' : totals.workspaces === 0 ? 'No workspaces match this search.' : 'No workspaces need attention.'} icon={<IconBuildingCommunity />} action={<a href={result.filtered || filters.attention ? '/agency' : '/settings/workspace'}>{result.filtered || filters.attention ? 'Reset filters' : 'View workspace'}</a>} />
        : <DataTable caption="Workspaces you manage" rows={result.workspaces} rowKey={item => item.id} columns={[
          { key: 'name', label: 'Workspace', render: item => <><strong>{item.name}</strong><span className={styles.meta}>{item.role === 'owner' ? 'Owner' : 'Admin'}</span></> },
          { key: 'status', label: 'Status', render: item => <Status item={item} /> },
          ...([['channels', 'Channels'], ['scheduled', 'Scheduled'], ['failed', 'Failed'], ['openTasks', 'Open tasks'], ['members', 'Team'], ['clients', 'Clients']] as const).map(([key, label]) => ({ key, label, align: 'end' as const, render: (item: AgencyWorkspace) => <Cell value={item.metrics?.[key]} /> })),
          { key: 'actions', label: 'Actions', render: item => <Actions item={item} /> },
        ]} />}

    </AgencyShell>;
  } catch (error) {
    return <AgencyShell><AgencyHeading description="Compare the workspaces you manage." /><RouteNotice error focusKey="agency-load-error">{error instanceof OperationError ? error.message : 'Agency data could not be loaded. Refresh and try again.'}</RouteNotice></AgencyShell>;
  }
}
