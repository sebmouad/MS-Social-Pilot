import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { readRootBackupStatus, readRootDiagnosticsSummary } from '@/server/root/legacy/backups';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_BACKUPS_COPY, backupsCopyText } from '@/lib/config/root-backups-copy';
import '../plans/legacy-ops.css';

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
    <header className="root-control__heading">
      <p className="root-config__eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p>{copy.intro}</p>
    </header>
    {!backups ? <section className="root-control__notice" role="alert"><h2>{copy.unavailable}</h2><p>{copy.recordsReadFailure}</p></section> : <>
      <section className="root-control__notice" aria-label={copy.limitsLabel}><h2>{backups.summary}</h2>
        <ul>{backups.limits.map(limit => <li key={limit}>{limit}</li>)}</ul></section>
      {backups.checks.length > 0 && <div className="root-ops__tiles">{backups.checks.map(check => <div key={check.kind} className={`root-ops__tile${check.state === 'recent' ? '' : ' root-ops__tile--attention'}`}>
        <strong>{check.label}</strong><span>{copy.state[check.state]}</span>
        <span className="root-ops__muted">{check.lastSuccessAt ? check.ageHours === null ? backupsCopyText(copy.lastSuccessAgeUnknown, { time: new Date(check.lastSuccessAt).toLocaleString() }) : backupsCopyText(copy.lastSuccess, { time: new Date(check.lastSuccessAt).toLocaleString(), age: check.ageHours }) : copy.noSuccess}</span>
        <span className="root-ops__muted">{backupsCopyText(copy.staleAfter, { hours: check.staleAfterHours })}</span>
      </div>)}</div>}
      <section className="root-ops__panel" aria-labelledby="runs"><h2 id="runs">{copy.runsTitle}</h2>
        {backups.runs.length === 0 ? <p className="root-ops__muted">{backups.source === 'unavailable' ? copy.noRunsUnavailable : copy.noRuns}</p> : <div className="root-ops__table" role="region" aria-label={copy.runsRegion} tabIndex={0}><table>
          <caption className="ui-visually-hidden">{copy.runsCaption}</caption>
          <thead><tr><th scope="col">{copy.finished}</th><th scope="col">{copy.kind}</th><th scope="col">{copy.result}</th><th scope="col">{copy.note}</th></tr></thead>
          <tbody>{backups.runs.map(run => <tr key={run.id}><td><time dateTime={run.finishedAt}>{new Date(run.finishedAt).toLocaleString()}</time></td><td>{run.kind === 'offsite' ? copy.offsiteBackup : run.kind === 'restore_test' ? copy.restoreTest : run.kind}</td><td>{run.status === 'ok' ? copy.success : copy.failed}</td><td>{run.detail ?? ''}</td></tr>)}</tbody>
        </table></div>}
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
