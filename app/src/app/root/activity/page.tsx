import { RootEmptyState } from '@/modules/root/ui/RootEmptyState';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { ROOT_AUDIT_BOUNDS, auditControlsText } from '@/lib/config/root-audit-controls';
import { AuditExport, AuditRetention } from './AuditControls';
import { revalidatePath } from 'next/cache';
import { readAuditConfig, saveAuditSettings } from '@/server/root/audit-config';
import { requireRootPage } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { listRootActivity } from '@/server/root/activity';
import { RootActivityFilters } from '@/modules/root/ui/RootActivityFilters';
import { rootActivitySearchParams, type RootActivitySearch } from '@/lib/root-activity';
import { OperationError } from '@/lib/operation-error';
import { loadRootDates, loadRootInterfaceCopy, rootText } from '@/modules/root/ui/interface-copy';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Activity · Root' };

export default async function RootActivityPage({ searchParams }: { searchParams: Promise<RootActivitySearch> }) {
  const actor = await requireRootPage();
  const t = await loadRootInterfaceCopy();
  const params = await searchParams;
  const [auditPolicy, auditCopy, downloadPolicy] = await Promise.all([readAuditConfig(), runtimeConfig('root.auditControlsCopy'), runtimeConfig('root.auditDownloadPolicy')]);
  async function saveRetention(_previous: string, data: FormData) {
    'use server';
    const current = await requireRootPage();
    const raw = String(data.get('days') ?? '');
    if (!/^\d+$/.test(raw) || Number(raw) > ROOT_AUDIT_BOUNDS.retentionDays.max) return auditControlsText(auditCopy.invalidDays, ROOT_AUDIT_BOUNDS.retentionDays);
    try {
      await saveAuditSettings(current.id, { 'root.auditRetentionDays': Number(raw), 'root.auditExportMaxRows': Number(data.get('exportRows')), 'root.auditRetentionBatchSize': Number(data.get('batchSize')) });
      revalidatePath('/root/activity');
      return auditCopy.saved;
    } catch { return auditCopy.saveFailure; }
  }
  let activities: Awaited<ReturnType<typeof listRootActivity>> | null = null;
  let policy: { pageSize: number; searchCharacters: number } | null = null;
  let invalid = false;
  try {
    const [pageSize, searchCharacters] = await Promise.all([runtimeConfig('root.activityPageSize'), runtimeConfig('root.activitySearchMaxCharacters')]);
    policy = { pageSize, searchCharacters };
    activities = await listRootActivity(actor.id, rootActivitySearchParams(params));
  } catch (error) { invalid = error instanceof OperationError && error.code === 'invalid_request'; }
  const filtered = Boolean(activities && Object.values(activities.filters).some(Boolean));
  return <RootFrame active="/root/activity">
    <PageHeader module="root" title="Activity" description={<>Recorded changes across this installation. Dates and times use UTC. Sensitive audit details are omitted.</>} />
    {activities && <AuditExport href={`/api/root/activity/export?${new URLSearchParams(Object.entries(activities.filters).filter(([, value]) => Boolean(value)))}`} limit={auditPolicy.exportMaxRows} copy={auditCopy} downloadPolicy={downloadPolicy} />}
    <AuditRetention days={auditPolicy.retentionDays} exportRows={auditPolicy.exportMaxRows} batchSize={auditPolicy.batchSize} save={saveRetention} copy={auditCopy} />
    {await RootActivityFilters({ values: params, page: activities, policy })}
    {activities === null ? <section className="root-control__notice" role="alert"><h2>{invalid ? 'Check activity filters' : 'Activity is unavailable'}</h2><p>{invalid ? 'A date, search or page link is invalid. Adjust the sidebar filters or reset to the latest activity.' : 'The audit store could not be read. Please retry, or check database availability.'}</p><a href="/root/activity">Reset to latest activity</a></section> : activities.items.length === 0 ? <RootEmptyState route="/root/activity" title={params.cursor ? 'No activity on this page' : filtered ? 'No activity matches these filters' : 'No activity recorded'}>{params.cursor ? 'Recorded events may have changed. Open the latest matching activity from the sidebar.' : filtered ? 'Try another action, person, workspace or date range.' : 'Installation and workspace actions will appear here when recorded.'}</RootEmptyState> : <><p className="root-activity__summary">Showing {activities.items.length} {filtered ? 'matching ' : ''}recorded {activities.items.length === 1 ? 'event' : 'events'}.</p><DataTable caption="Activity" rows={activities.items} rowKey={item => item.id} columns={[
      { key: 'action', label: t.colAction, render: item => <strong>{item.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</strong> },
      { key: 'time', label: t.colRecordedUtc, render: item => <time dateTime={item.createdAt.toISOString()}>{item.createdAt.toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace(/Z$/, ' UTC')}</time> },
      { key: 'actor', label: t.colAccount, render: item => <>{item.actor ? `${item.actor.name} · ${item.actor.email}` : t.valueSystemAccount}</> },
      { key: 'details', label: t.colActivityDetails, render: item => <ul>{item.metadata.map(value => <li key={value}>{value}</li>)}</ul> },
    ]} /></>}
  </RootFrame>;
}
