import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { canAccessFeature } from '@/server/permissions';
import { listReportSchedules } from '@/modules/analytics/reports/server/schedules';
import { listReportTemplates } from '@/modules/analytics/reports/server/templates';
import { listReportRuns, reportFailureText } from '@/modules/analytics/reports/generation/runs';
import { reportCapabilities } from '@/modules/analytics/reports/generation/registry';
import { reportLimits } from '@/modules/analytics/reports/server/limits';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import { ensureReportWorkflows, reportDefaultPeriod, reportTemplateOptions } from '@/modules/analytics/server/report-workflows';
import { loadReportUiPolicy } from '@/modules/analytics/server/report-ui-policy';
import { ReportsManager } from './ReportsManager';
import { WorkflowNav } from './WorkflowNav';
import styles from './workflows.module.css';

type PageValue = string | string[] | undefined;
const parsePage = (value: PageValue) => value === undefined ? 1 : typeof value === 'string' && /^[1-9]\d{0,3}$/.test(value) ? Number(value) : null;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ page?: PageValue; runsPage?: PageValue }> }) {
  const viewer = await requireViewer({ feature: 'analytics/reports', channelScoped: true });
  const params = await searchParams;
  const page = parsePage(params.page);
  const runsPage = parsePage(params.runsPage);
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canManage = canAccessFeature(viewer.permissions, 'analytics/reports', 'write');
  type Data = {
    templates: Awaited<ReturnType<typeof listReportTemplates>>;
    schedules: Awaited<ReturnType<typeof listReportSchedules>>;
    channels: Array<{ id: string; name: string }>;
    templateOptions: Array<{ id: string; name: string }>;
    runs: Awaited<ReturnType<typeof listReportRuns>>;
    policy: Awaited<ReturnType<typeof loadReportUiPolicy>>;
    limits: Awaited<ReturnType<typeof reportLimits>>;
    defaultPeriod: Awaited<ReturnType<typeof reportDefaultPeriod>> | null;
  };
  let failure = '';
  let data: Data | null = null;
  let canSchedule = false;
  let canGenerate = false;
  try {
    if (page === null || runsPage === null) throw new OperationError('invalid_request', 'Choose a valid page number. Use the page links to return to an available result page.');
    await ensureReportWorkflows();
    const capabilities = await reportCapabilities();
    canSchedule = capabilities.schedules;
    canGenerate = capabilities.generate;
    const channelSnapshotPromise = canManage && (canSchedule || canGenerate)
      ? readAnalyticsSnapshot(actor, {}, { feature: 'analytics/reports' })
      : Promise.resolve(null);
    const [templates, schedules, runs, policy, limits, defaultPeriod, templateOptions, channelSnapshot] = await Promise.all([
      listReportTemplates(actor, { page }), listReportSchedules(actor, { page }),
      canGenerate ? listReportRuns(actor, { page: runsPage }) : Promise.resolve({ ok: true as const, runs: [], page: runsPage, hasMore: false }),
      loadReportUiPolicy(actor), reportLimits(), canGenerate ? reportDefaultPeriod().catch(() => null) : Promise.resolve(null), reportTemplateOptions(actor),
      channelSnapshotPromise,
    ]);
    // Channel choices are scoped to report access; no broader overview entitlement is required.
    const channels = channelSnapshot?.options.channels ?? [];
    data = { templates, schedules, channels, templateOptions, runs, policy, limits, defaultPeriod };
  } catch (error) { failure = operationFailure(error, 'Reports could not be loaded. Please try again.').error; }

  return <PageFrame module="analytics" scopedAccess sidebar={<WorkflowNav current="/analytics/reports" />}><div className={styles.root}>
    <header className={styles.heading}><p className={styles.eyebrow}>Analytics</p><h1>Saved reports and schedules</h1><p>{canSchedule ? 'Reuse report layouts and have them prepared and emailed weekly or monthly for the channels you manage.' : canGenerate ? 'Reuse report layouts and prepare downloadable reports for the channels you manage.' : 'Reuse report layouts across your channels.'}</p></header>
    {failure && <section className={styles.panel} role="alert"><h2>Reports could not be loaded</h2><p>{failure}</p><a href="/analytics/reports">Return to the first page</a></section>}
    {data && <ReportsManager page={page!} runsPage={runsPage!} runsHasMore={data.runs.hasMore} canManage={canManage} canSchedule={canSchedule} canGenerate={canGenerate}
      policy={data.policy} limits={{ nameMax: data.limits.nameMax, maxRecipients: data.limits.maxRecipients, maxRows: data.limits.maxRows, maxBytes: data.limits.maxBytes }}
      defaultPeriod={data.defaultPeriod}
      timeZone={viewer.membership.workspace.timezone} channels={data.channels} templateOptions={data.templateOptions} hasMoreTemplates={data.templates.hasMore} hasMoreSchedules={data.schedules.hasMore}
      templates={data.templates.templates.map(t => ({ id: t.id, name: t.name, sections: t.sections, rangeKey: t.rangeKey, scheduleCount: t.scheduleCount }))}
      schedules={data.schedules.schedules.map(s => ({ id: s.id, channelId: s.channelId, channelName: s.channelName, templateId: s.templateId, templateName: s.templateName, frequency: s.frequency, recipientCount: s.recipientCount, recipients: s.recipients, nextRunAt: s.nextRunAt.toISOString(), lastOutcome: s.lastOutcome }))}
      runs={data.runs.runs.map(r => ({ id: r.id, channelId: r.channelId, kind: r.kind, status: r.status, periodStart: r.periodStart, periodEnd: r.periodEnd, startedAt: r.startedAt.toISOString(), rowCount: r.rowCount, truncated: r.truncated, note: reportFailureText(r.failureReason), deliveries: r.deliveries.map(d => ({ mask: d.mask, status: d.status })) }))} />}
  </div></PageFrame>;
}
