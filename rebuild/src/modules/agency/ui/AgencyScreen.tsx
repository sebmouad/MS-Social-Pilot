import { uiCopy, uiLocale, type UiLocale } from './copy';
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
import { Badge, DataTable, EmptyState, MetricCard } from '@/components';
import { BarChart } from '@/components/charts';
import { IconAlertTriangle, IconCalendar, IconChecklist, IconPlugConnected, IconBuildingCommunity } from '@tabler/icons-react';
import styles from './agency.module.css';

const KEYS = ['q', 'sort', 'order', 'attention'];
const WITHHELD = 'Not shown for workspaces where you lack access to this data';

function Status({ item, locale = 'en' }: { item: AgencyWorkspace; locale?: UiLocale }) {
  const t = uiCopy(locale);
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

function Actions({ item, locale = 'en' }: { item: AgencyWorkspace; locale?: UiLocale }) {
  const t = uiCopy(locale);
  if (item.state !== 'available' || !item.metrics) return <span className={styles.meta}>{t("Unavailable until the workspace is active")}</span>;
  const { metrics } = item;
  return <div className={styles.actions}>
    <WorkspaceAction locale={locale} workspaceId={item.id} workspaceName={item.name} href="/home" label={t("Open")} variant={item.needsAttention ? 'secondary' : 'primary'} />
    {(metrics.disconnected ?? 0) > 0 && <WorkspaceAction locale={locale} workspaceId={item.id} workspaceName={item.name} href="/settings/connections" label={t("Fix connections")} variant="primary" />}
    {(metrics.failed ?? 0) > 0 && <WorkspaceAction locale={locale} workspaceId={item.id} workspaceName={item.name} href="/publishing/posts" label={t("Review posts")} variant="primary" />}
    {(metrics.overdueTasks ?? 0) > 0 && <WorkspaceAction locale={locale} workspaceId={item.id} workspaceName={item.name} href="/tasks?overdue=true" label={t("Overdue tasks")} variant="primary" />}
  </div>;
}

/** A cell for one count: a withheld value is a dash with an explanation, never a zero. */
const Cell = ({ value, locale }: { value: number | null | undefined; locale: UiLocale }) => value == null ? <span title={uiCopy(locale)(WITHHELD)}>–<span className="sr-only"> {uiCopy(locale)(WITHHELD)}</span></span> : value;

/** Tells the reader when a total leaves out workspaces whose data this person cannot read. */
function Coverage({ totals, group, locale = 'en' }: { totals: AgencyTotals; group: AgencyGroup; locale?: UiLocale }) {
  const t = uiCopy(locale);
  const { covered, of } = totals.coverage[group];
  return covered < of ? <span className={styles.meta}>{t("Counted in")} {covered} {t("of")} {of} {t("workspaces")}</span> : null;
}

export default async function AgencyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Person-wide page: the selected workspace's role must not decide access; the service checks every membership.
  const viewer = await requireViewer({ channelScoped: true });
  const locale = uiLocale((await headers()).get('accept-language'));
  const t = uiCopy(locale);
  const params = await searchParams;
  const bad = Object.entries(params).some(([key, value]) => !KEYS.includes(key) || typeof value !== 'string')
    || (params.sort !== undefined && !(AGENCY_SORTS as readonly string[]).includes(String(params.sort)))
    || (params.order !== undefined && params.order !== 'asc' && params.order !== 'desc')
    || (params.attention !== undefined && params.attention !== 'true');
  if (bad) return <AgencyShell><AgencyHeading locale={locale} description={t("Review your filters.")} /><RouteNotice error focusKey="agency-filter-error">{t("Choose valid filters and try again.")}</RouteNotice><a href="/agency">{t("Reset filters")}</a></AgencyShell>;
  const filters = { q: String(params.q ?? ''), sort: String(params.sort ?? 'attention'), order: String(params.order ?? 'desc'), attention: params.attention === 'true' };
  try {
    const searchLimit = await agencySearchLimit();
    const result = await agencyOverview({ userId: viewer.user.id }, { ...(filters.q ? { q: filters.q } : {}), sort: filters.sort, order: filters.order, attentionOnly: filters.attention });
    const exportQuery = new URLSearchParams({ q: filters.q, sort: filters.sort, order: filters.order, attention: String(filters.attention) }).toString();
    const totals = result.totals;
    const sparkline = (key: 'scheduled' | 'failed') => result.workspaces.some(item => item.metrics?.[key] != null) ? result.workspaces.map(item => item.metrics?.[key] ?? null) : undefined;
    const scope = result.filtered ? t('{0} matching workspaces', totals.workspaces) : t("your workspaces");
    const count = (value: number | null) => value === null ? '–' : value;
    return <AgencyShell>
      <AgencyHeading locale={locale} description={t("Compare the workspaces you own or administer. Failed posts cover the last {0} days.", result.windowDays)} />
      <AgencyFilters key={JSON.stringify(filters)} locale={locale} values={filters} searchLimit={searchLimit} />
      <WorkspaceQuickSwitch locale={locale} workspaces={result.workspaces.filter(item => item.state === 'available' && item.metrics).map(({ id, name }) => ({ id, name }))} />
      <AgencyExport key={`${locale}:${exportQuery}`} query={exportQuery} locale={locale} />
      {result.truncated && <RouteNotice focusKey="agency-truncated">
        {(result.filtered ? t("More than {0} workspaces match this search; only the first {1} by name are shown. Search for more of the name to narrow them.", result.limit, result.limit)
          : t("You manage more than {0} workspaces; only the first {1} by name are shown. Search by name to find another workspace.", result.limit, result.limit))
          + (filters.attention ? t(" The needs-attention filter only looked at those {0}.", result.limit) : '')}
      </RouteNotice>}
      {totals.workspaces > 0 && <div className={styles.metrics} aria-label={t("Across {0}", scope)}>
        <MetricCard module="agency" icon={<IconBuildingCommunity size={20} />} label={result.filtered ? t("Matching workspaces") : t("Workspaces")} value={totals.workspaces} />
        <MetricCard module="agency" icon={<IconAlertTriangle size={20} />} label={t("Need attention")} value={totals.needingAttention} />
        <MetricCard module="agency" icon={<IconPlugConnected size={20} />} label={t("Channels that cannot publish")} value={count(totals.disconnected)} unavailable={totals.disconnected === null ? t(WITHHELD) : undefined} hint={<>{totals.channels !== null && t("of {0}", totals.channels)}<Coverage locale={locale} totals={totals} group="channels" /></>} />
        <MetricCard module="agency" icon={<IconAlertTriangle size={20} />} label={t("Failed posts")} sparkline={sparkline('failed')} sparklineLabel={`${t('Failed posts by listed workspace')}: ${result.workspaces.map(item => item.name).join(', ')}`} value={count(totals.failed)} unavailable={totals.failed === null ? t(WITHHELD) : undefined} hint={<><Coverage locale={locale} totals={totals} group="publishing" />{t('Each point shows a listed workspace’s current count, in table order.') }</>} />
        <MetricCard module="agency" icon={<IconCalendar size={20} />} label={t("Scheduled posts")} sparkline={sparkline('scheduled')} sparklineLabel={`${t('Scheduled posts by listed workspace')}: ${result.workspaces.map(item => item.name).join(', ')}`} value={count(totals.scheduled)} unavailable={totals.scheduled === null ? t(WITHHELD) : undefined} hint={<><Coverage locale={locale} totals={totals} group="publishing" />{t('Each point shows a listed workspace’s current count, in table order.') }</>} />
        <MetricCard module="agency" icon={<IconChecklist size={20} />} label={t("Overdue tasks")} value={count(totals.overdueTasks)} unavailable={totals.overdueTasks === null ? t(WITHHELD) : undefined} hint={<>{totals.openTasks !== null && t("of {0} open", totals.openTasks)}<Coverage locale={locale} totals={totals} group="tasks" /></>} />
      </div>}
      {result.workspaces.some(item => item.metrics?.scheduled != null || item.metrics?.failed != null) && <BarChart label={t("Scheduled posts · Failed posts")} locale={locale} categories={result.workspaces.map(item => item.name)} series={[
        { id: 'scheduled', name: t("Scheduled posts"), values: result.workspaces.map(item => item.metrics?.scheduled ?? null) },
        { id: 'failed', name: t("Failed posts"), values: result.workspaces.map(item => item.metrics?.failed ?? null) },
      ]} orientation="horizontal" />}
      {result.workspaces.length === 0
        ? <EmptyState title={totals.workspaces === 0 && !result.filtered ? t("You do not own or administer any workspace with Agency access yet.") : totals.workspaces === 0 ? t("No workspaces match this search.") : t("No workspaces need attention.")} icon={<IconBuildingCommunity />} action={<a href={result.filtered || filters.attention ? '/agency' : '/settings/workspace'}>{result.filtered || filters.attention ? t("Reset filters") : t("View workspace")}</a>} />
        : <DataTable caption={t("Workspaces you manage")} rows={result.workspaces} rowKey={item => item.id} columns={[
          { key: 'name', label: t("Workspace"), render: item => <><strong>{item.name}</strong><span className={styles.meta}>{item.role === 'owner' ? t("Owner") : t("Admin")}</span></> },
          { key: 'status', label: t("Status"), render: item => <Status locale={locale} item={item} /> },
          ...([['channels', t("Channels")], ['scheduled', t("Scheduled")], ['failed', t("Failed")], ['openTasks', t("Open tasks")], ['members', t("Team")], ['clients', t("Clients")]] as const).map(([key, label]) => ({ key, label: t(label), align: 'end' as const, render: (item: AgencyWorkspace) => <Cell locale={locale} value={item.metrics?.[key]} /> })),
          { key: 'actions', label: t("Actions"), render: item => <Actions locale={locale} item={item} /> },
        ]} />}

    </AgencyShell>;
  } catch (error) {
    return <AgencyShell><AgencyHeading locale={locale} description={t("Compare the workspaces you manage.")} /><RouteNotice error focusKey="agency-load-error">{error instanceof OperationError ? error.message : t("Agency data could not be loaded. Refresh and try again.")}</RouteNotice></AgencyShell>;
  }
}
