import { Badge } from '@/components/Badge';
import { IconDatabase } from '@tabler/icons-react';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { readRootBackupStatus, readRootDiagnosticsSummary } from '@/modules/root/server/admin/backups';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_BACKUPS_COPY, backupsCopyText } from '@/lib/config/root-backups-copy';
import '../plans/root-ops.css';

export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const copy = await runtimeConfig('root.backupsCopy').catch(() => ROOT_BACKUPS_COPY);
  return { title: copy.metadataTitle };
}

export default async function RootBackupsPage() {
  const actor = await requireRootPage();
  const [copy, result] = await Promise.all([
    runtimeConfig('root.backupsCopy').catch(() => ROOT_BACKUPS_COPY),
    Promise.all([readRootBackupStatus(actor.id), readRootDiagnosticsSummary(actor.id)]).then(([b, d]) => [b, d] as const).catch(() => [null, null] as const)
  ]);
  const [backups, diagnostics] = result;
  return <RootFrame active="/root/backups"><div className="root-ops">
    <PageHeader module="root" title={copy.title} description={<>{copy.intro}</>} />
    {!backups ? <section className="root-control__notice" role="alert"><h2>{copy.unavailable}</h2><p>{copy.recordsReadFailure}</p></section> : <>
      <section className="root-control__notice" aria-label={copy.limitsLabel}><h2>{backups.summary}</h2>
        <ul>{backups.limits.map(limit => <li key={limit}>{limit}</li>)}</ul></section>
      {backups.checks.length > 0 && <div className="root-ops__tiles">{backups.checks.map(check => <div key={check.kind} className={`root-ops__tile${check.state === 'recent' ? '' : ' root-ops__tile--attention'}`}>
        <strong>{check.label}</strong><Badge tone={check.state === 'recent' ? 'success' : check.state === 'failed_latest' ? 'danger' : 'warning'} icon={<IconDatabase size={14} />}>{copy.state[check.state]}</Badge>
        <span className="root-ops__muted">{check.lastSuccessAt ? check.ageHours === null ? backupsCopyText(copy.lastSuccessAgeUnknown, { time: new Date(check.lastSuccessAt).toLocaleString() }) : backupsCopyText(copy.lastSuccess, { time: new Date(check.lastSuccessAt).toLocaleString(), age: check.ageHours }) : copy.noSuccess}</span>
        <span className="root-ops__muted">{backupsCopyText(copy.staleAfter, { hours: check.staleAfterHours })}</span>
      </div>)}</div>}
      <section className="root-ops__panel" aria-labelledby="runs"><h2 id="runs">{copy.runsTitle}</h2>
        {backups.runs.length === 0 ? <p className="root-ops__muted">{backups.source === 'unavailable' ? copy.noRunsUnavailable : copy.noRuns}</p> : <DataTable caption={copy.runsCaption} rows={backups.runs} rowKey={run => run.id} columns={[
          { key: 'column0', label: copy.finished, render: (run) => <><time dateTime={run.finishedAt}>{new Date(run.finishedAt).toLocaleString()}</time></> },
          { key: 'column1', label: copy.kind, render: (run) => <>{run.kind === 'offsite' ? copy.offsiteBackup : run.kind === 'restore_test' ? copy.restoreTest : run.kind}</> },
          { key: 'column2', label: copy.result, render: (run) => <Badge tone={run.status === 'ok' ? 'success' : 'danger'}>{run.status === 'ok' ? copy.success : copy.failed}</Badge> },
          { key: 'column3', label: copy.note, render: (run) => <>{run.detail ?? ''}</> }
        ]} />}
      </section>
    </>}
    <section className="root-ops__panel" aria-labelledby="diag"><h2 id="diag">{copy.diagnosticsTitle}</h2>
      {!diagnostics ? <p className="root-ops__muted">{copy.diagnosticsFailure}</p> : <>
        <p>{diagnostics.errors ? backupsCopyText(copy.openErrors, { count: diagnostics.errors.open, recent: diagnostics.errors.openLast24h }) : copy.errorsUnknown}. <a href="/root/errors">{copy.openErrorLog}</a></p>
        <p>{diagnostics.openAlerts === null ? copy.alertsUnknown : backupsCopyText(copy.openAlerts, { count: diagnostics.openAlerts.length })}</p>
        {diagnostics.openAlerts && diagnostics.openAlerts.length > 0 && <ul>{diagnostics.openAlerts.map(alert => <li key={alert.id}>{backupsCopyText(copy.alertOpened, { key: alert.key, time: new Date(alert.openedAt).toLocaleString() })}</li>)}</ul>}
        <p className="root-ops__muted">{backupsCopyText(copy.providerHealth, { note: diagnostics.providerHealth.note })} <a href="/root/operations">{copy.operationsLink}</a>.</p>
      </>}
    </section>
  </div></RootFrame>;
}
