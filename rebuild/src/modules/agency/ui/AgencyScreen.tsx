import { loadCustomerCopy, loadExportCopy } from '../server/copy';
import { uiCopy, uiLocale, type CustomerCopy, type UiLocale } from './copy';
import { WorkspaceQuickSwitch } from './WorkspaceQuickSwitch';
import { headers } from 'next/headers';
import { AgencyExport } from './AgencyExport';
import { requireViewer } from '@/server/context';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { AGENCY_SORTS, type AgencyGroup, type AgencyTotals, type AgencyWorkspace } from '@/modules/agency/agency';
import { agencyOverview, agencySearchLimit } from '@/modules/agency/server/agency';
import { AgencyFilters } from './AgencyFilters';
import { AgencyHeading, AgencyShell } from './AgencyChrome';
import { WorkspaceAction } from './WorkspaceAction';
import { Badge, DataTable, EmptyState, MetricCard, InfoTip } from '@/components';
import { IconAlertTriangle, IconCalendar, IconChecklist, IconInbox, IconPlugConnected, IconBuildingCommunity } from '@tabler/icons-react';
import { pageChannelScope } from '@/modules/shell/server/scope';
import styles from './agency.module.css';

const KEYS = ['q', 'sort', 'order', 'attention', 'channel'];
const WITHHELD = 'Not shown for workspaces where you lack access to this data';

function Status({ item, locale = 'en', copy }: { item: AgencyWorkspace; copy?: CustomerCopy; locale?: UiLocale }) {
  const t = uiCopy(locale, copy);
  if (item.state === 'suspended') return <Badge tone="warning">{t("Suspended")}</Badge>;
  if (item.state === 'deleting') return <Badge tone="warning">{t("Data deletion in progress")}</Badge>;
  const metrics = item.metrics;
  return <>
    {item.needsAttention ? <Badge tone="warning">{t("Needs attention")}</Badge> : <Badge tone="success">{t("Healthy")}</Badge>}
    {metrics && (metrics.disconnected ?? 0) > 0 && <span className={styles.meta}>{metrics.disconnected} {t("of")} {metrics.channels} {t("channels cannot publish")}</span>}
    {metrics && (metrics.failed ?? 0) > 0 && <span className={styles.meta}>{metrics.failed} {t("failed posts")}</span>}
    {metrics && (metrics.overdueTasks ?? 0) > 0 && <span className={styles.meta}>{metrics.overdueTasks} {t("overdue tasks")}</span>}
  </>;
}

function Actions({ item, locale = 'en', copy }: { item: AgencyWorkspace; copy?: CustomerCopy; locale?: UiLocale }) {
  const t = uiCopy(locale, copy);
  if (item.state !== 'available' || !item.metrics) return <span className={styles.meta}>{t("Unavailable until the workspace is active")}</span>;
  const { metrics } = item;
  return <div className={styles.actions}>
    <WorkspaceAction locale={locale} copy={copy} workspaceId={item.id} workspaceName={item.name} href="/home" label={t("Open")} variant="secondary" />
    {(metrics.disconnected ?? 0) > 0 && <WorkspaceAction locale={locale} copy={copy} workspaceId={item.id} workspaceName={item.name} href="/settings/channels" label={t("Fix connections")} variant="secondary" />}
    {(metrics.failed ?? 0) > 0 && <WorkspaceAction locale={locale} copy={copy} workspaceId={item.id} workspaceName={item.name} href="/content" label={t("Review posts")} variant="secondary" />}
    {(metrics.waitingConversations ?? 0) > 0 && <WorkspaceAction locale={locale} copy={copy} workspaceId={item.id} workspaceName={item.name} href="/inbox" label={t("Open inbox")} variant="secondary" />}
    {(metrics.overdueTasks ?? 0) > 0 && <WorkspaceAction locale={locale} copy={copy} workspaceId={item.id} workspaceName={item.name} href="/tasks?overdue=true" label={t("Overdue tasks")} variant="secondary" />}
  </div>;
}

/** A cell for one count: a withheld value is a dash with an explanation, never a zero. */
const Cell = ({ value, locale, copy }: { value: number | null | undefined; locale: UiLocale; copy?: CustomerCopy }) => value == null ? <span title={uiCopy(locale, copy)(WITHHELD)}>–<span className="sr-only"> {uiCopy(locale, copy)(WITHHELD)}</span></span> : value;

/** Tells the reader when a total leaves out workspaces whose data this person cannot read. */
function Coverage({ totals, group, locale = 'en', copy }: { totals: AgencyTotals; group: AgencyGroup; copy?: CustomerCopy; locale?: UiLocale }) {
  const t = uiCopy(locale, copy);
  const { covered, of } = totals.coverage[group];
  return covered < of ? <span className={styles.meta}>{t("Counted in")} {covered} {t("of")} {of} {t("workspaces")}</span> : null;
}

export default async function AgencyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Person-wide page: the selected workspace's role must not decide access; the service checks every membership.
  const viewer = await requireViewer({ channelScoped: true });
  const locale = uiLocale((await headers()).get('accept-language'));
  const [copy, exportCopy] = await Promise.all([loadCustomerCopy(), loadExportCopy()]);
  const t = uiCopy(locale, copy);
  const params = await searchParams;
  const bad = Object.entries(params).some(([key, value]) => !KEYS.includes(key) || typeof value !== 'string')
    || (params.sort !== undefined && !(AGENCY_SORTS as readonly string[]).includes(String(params.sort)))
    || (params.order !== undefined && params.order !== 'asc' && params.order !== 'desc')
    || (params.attention !== undefined && params.attention !== 'true');
  if (bad) return <AgencyShell><AgencyHeading locale={locale} copy={copy} description={t("Review your filters.")} /><RouteNotice error focusKey="agency-filter-error">{t("Choose valid filters and try again.")}</RouteNotice><a href="/agency">{t("Reset filters")}</a></AgencyShell>;
  const filters = { q: String(params.q ?? ''), sort: String(params.sort ?? 'attention'), order: String(params.order ?? 'desc'), attention: params.attention === 'true' };
  // Agency spans every administered workspace, so the channel scope cannot filter it. The parameter is accepted
  // (validated centrally like every page) and clarified with a notice, never silently ignored.
  const scope = typeof params.channel === 'string' && params.channel ? await pageChannelScope(viewer, params).catch(() => null) : null;
  try {
    const searchLimit = await agencySearchLimit();
    const result = await agencyOverview({ userId: viewer.user.id }, { ...(filters.q ? { q: filters.q } : {}), sort: filters.sort, order: filters.order, attentionOnly: filters.attention });
    const exportQuery = new URLSearchParams({ q: filters.q, sort: filters.sort, order: filters.order, attention: String(filters.attention) }).toString();
    const totals = result.totals;
    const scope = result.filtered ? t('{0} matching workspaces', totals.workspaces) : t("your workspaces");
    const count = (value: number | null) => value === null ? '–' : value;
    return <AgencyShell>
      <AgencyHeading locale={locale} copy={copy} description={t("Compare the workspaces you own or administer. Failed posts cover the last {0} days.", result.windowDays)}
        filters={<AgencyFilters key={JSON.stringify(filters)} locale={locale} copy={copy} values={filters} searchLimit={searchLimit} />}
        actions={<AgencyExport key={`${locale}:${exportQuery}`} query={exportQuery} locale={locale} catalog={exportCopy} />} />
      <WorkspaceQuickSwitch locale={locale} copy={copy} workspaces={result.workspaces.filter(item => item.state === 'available' && item.metrics).map(({ id, name }) => ({ id, name }))} />
      {scope && <RouteNotice focusKey="agency-scope-notice">{t("Agency compares every workspace you manage; the channel scope does not filter it.")}</RouteNotice>}
      {result.truncated && <RouteNotice focusKey="agency-truncated">
        {(result.filtered ? t("More than {0} workspaces match this search; only the first {1} by name are shown. Search for more of the name to narrow them.", result.limit, result.limit)
          : t("You manage more than {0} workspaces; only the first {1} by name are shown. Search by name to find another workspace.", result.limit, result.limit))
          + (filters.attention ? t(" The needs-attention filter only looked at those {0}.", result.limit) : '')}
      </RouteNotice>}
      {totals.workspaces > 0 && <div className={styles.metrics} aria-label={t("Across {0}", scope)}>
        <MetricCard module="agency" icon={<IconBuildingCommunity size={20} />} label={result.filtered ? t("Matching workspaces") : t("Workspaces")} value={totals.workspaces} />
        <MetricCard module="agency" icon={<IconAlertTriangle size={20} />} label={t("Need attention")} value={totals.needingAttention} />
        <MetricCard module="agency" icon={<IconPlugConnected size={20} />} label={t("Channels that cannot publish")} value={count(totals.disconnected)} unavailable={totals.disconnected === null ? t(WITHHELD) : undefined} info={<InfoTip name={t("Channels that cannot publish")} warning={totals.coverage.channels.covered < totals.coverage.channels.of}><p>{totals.channels !== null && t("of {0}", totals.channels)}<Coverage locale={locale} copy={copy} totals={totals} group="channels" /></p></InfoTip>} />
        <MetricCard module="agency" icon={<IconAlertTriangle size={20} />} label={t("Failed posts")} value={count(totals.failed)} unavailable={totals.failed === null ? t(WITHHELD) : undefined} info={<InfoTip name={t("Failed posts")} warning={totals.coverage.publishing.covered < totals.coverage.publishing.of}><p>{t("Compare the workspaces you own or administer. Failed posts cover the last {0} days.", result.windowDays)}<Coverage locale={locale} copy={copy} totals={totals} group="publishing" /></p></InfoTip>} />
        <MetricCard module="agency" icon={<IconCalendar size={20} />} label={t("Scheduled posts")} value={count(totals.scheduled)} unavailable={totals.scheduled === null ? t(WITHHELD) : undefined} info={<InfoTip name={t("Scheduled posts")} warning={totals.coverage.publishing.covered < totals.coverage.publishing.of}><p>{t("Compare the workspaces you own or administer. Failed posts cover the last {0} days.", result.windowDays)}<Coverage locale={locale} copy={copy} totals={totals} group="publishing" /></p></InfoTip>} />
        <MetricCard module="agency" icon={<IconInbox size={20} />} label={t("Waiting conversations")} value={count(totals.waitingConversations)} unavailable={totals.waitingConversations === null ? t(WITHHELD) : undefined} info={<InfoTip name={t("Waiting conversations")} warning={totals.coverage.inbox.covered < totals.coverage.inbox.of}><p>{t("Unresolved messages, comments and reviews.")}<Coverage locale={locale} copy={copy} totals={totals} group="inbox" /></p></InfoTip>} />
        <MetricCard module="agency" icon={<IconChecklist size={20} />} label={t("Overdue tasks")} value={count(totals.overdueTasks)} unavailable={totals.overdueTasks === null ? t(WITHHELD) : undefined} info={<InfoTip name={t("Overdue tasks")} warning={totals.coverage.tasks.covered < totals.coverage.tasks.of}><p>{totals.openTasks !== null && t("of {0} open", totals.openTasks)}<Coverage locale={locale} copy={copy} totals={totals} group="tasks" /></p></InfoTip>} />
      </div>}
      {result.workspaces.length === 0
        ? <EmptyState title={totals.workspaces === 0 && !result.filtered ? t("You do not own or administer any workspace with Agency access yet.") : totals.workspaces === 0 ? t("No workspaces match this search.") : t("No workspaces need attention.")} icon={<IconBuildingCommunity />} action={<a href={result.filtered || filters.attention ? '/agency' : '/settings/workspace'}>{result.filtered || filters.attention ? t("Reset filters") : t("View workspace")}</a>} />
        : <DataTable caption={t("Workspaces you manage")} rows={result.workspaces} rowKey={item => item.id} columns={[
          { key: 'name', label: t("Workspace"), render: item => <><strong>{item.name}</strong><span className={styles.meta}>{item.role === 'owner' ? t("Owner") : t("Admin")}</span></> },
          { key: 'status', label: t("Status"), render: item => <Status locale={locale} copy={copy} item={item} /> },
          ...([['channels', t("Channels")], ['scheduled', t("Scheduled")], ['failed', t("Failed")], ['waitingConversations', t("Waiting conversations")], ['openTasks', t("Open tasks")], ['members', t("Team")], ['clients', t("Clients")]] as const).map(([key, label]) => ({ key, label: t(label), align: 'end' as const, render: (item: AgencyWorkspace) => <Cell locale={locale} copy={copy} value={item.metrics?.[key]} /> })),
          { key: 'actions', label: t("Actions"), render: item => <Actions locale={locale} copy={copy} item={item} /> },
        ]} />}

    </AgencyShell>;
  } catch (error) {
    return <AgencyShell><AgencyHeading locale={locale} copy={copy} description={t("Compare the workspaces you manage.")} /><RouteNotice error focusKey="agency-load-error">{error instanceof OperationError ? t(error.message) : t("Agency data could not be loaded. Refresh and try again.")}</RouteNotice></AgencyShell>;
  }
}
