import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { readRootBackupStatus, readRootDiagnosticsSummary } from '@/server/root/legacy/backups';
import '../plans/legacy-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Backups · Root' };

const STATE_TEXT = { recent: 'Recorded recently', stale: 'Record is out of date', failed_latest: 'Latest run failed', never_recorded: 'Never recorded' } as const;

export default async function RootBackupsPage() {
  const actor = await requireRootPage();
  const [backups, diagnostics] = await Promise.all([readRootBackupStatus(actor.id), readRootDiagnosticsSummary(actor.id)]).then(([b, d]) => [b, d] as const).catch(() => [null, null] as const);
  return <RootFrame active="/root/backups"><div className="root-ops">
    <header className="root-control__heading">
      <p className="root-config__eyebrow">Root · Shared controls</p>
      <h1>Backups and diagnostics</h1>
      <p>Read-only view of what the server backup scripts recorded. Root cannot start, restore or verify a backup from this screen.</p>
    </header>
    {!backups ? <section className="root-control__notice" role="alert"><h2>Status unavailable</h2><p>Backup records could not be read. Backup state is unverified.</p></section> : <>
      <section className="root-control__notice" aria-label="What this does not prove"><h2>{backups.summary}</h2>
        <ul>{backups.limits.map(limit => <li key={limit}>{limit}</li>)}</ul></section>
      {backups.checks.length > 0 && <div className="root-ops__tiles">{backups.checks.map(check => <div key={check.kind} className={`root-ops__tile${check.state === 'recent' ? '' : ' root-ops__tile--attention'}`}>
        <strong>{check.label}</strong><span>{STATE_TEXT[check.state]}</span>
        <span className="root-ops__muted">{check.lastSuccessAt ? `Last success ${new Date(check.lastSuccessAt).toLocaleString()} (${check.ageHours} h ago)` : 'No successful run recorded'}</span>
        <span className="root-ops__muted">Flagged as out of date after {check.staleAfterHours} h. Archive contents unverified.</span>
      </div>)}</div>}
      <section className="root-ops__panel" aria-labelledby="runs"><h2 id="runs">Recorded runs</h2>
        {backups.runs.length === 0 ? <p className="root-ops__muted">{backups.source === 'unavailable' ? 'This database has no backup record table.' : 'No runs have been recorded. Backup state is unverified.'}</p> : <div className="root-ops__table" role="region" aria-label="Recorded backup runs" tabIndex={0}><table>
          <caption className="ui-visually-hidden">Recorded backup and restore-test runs</caption>
          <thead><tr><th scope="col">Finished</th><th scope="col">Kind</th><th scope="col">Result reported</th><th scope="col">Note</th></tr></thead>
          <tbody>{backups.runs.map(run => <tr key={run.id}><td><time dateTime={run.finishedAt}>{new Date(run.finishedAt).toLocaleString()}</time></td><td>{run.kind === 'offsite' ? 'Off-site backup' : run.kind === 'restore_test' ? 'Restore test' : run.kind}</td><td>{run.status === 'ok' ? 'Success' : 'Failed'}</td><td>{run.detail ?? ''}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </>}
    <section className="root-ops__panel" aria-labelledby="diag"><h2 id="diag">Installation diagnostics</h2>
      {!diagnostics ? <p className="root-ops__muted">Diagnostics could not be read.</p> : <>
        <p>Open errors: {diagnostics.errors ? `${diagnostics.errors.open} (${diagnostics.errors.openLast24h} seen in the last 24 hours)` : 'unknown (error log unavailable)'}. <a href="/root/errors">Open the error log</a></p>
        <p>Open system alerts: {diagnostics.openAlerts === null ? 'unknown (alert records unavailable)' : diagnostics.openAlerts.length}</p>
        {diagnostics.openAlerts && diagnostics.openAlerts.length > 0 && <ul>{diagnostics.openAlerts.map(alert => <li key={alert.id}>{alert.key} since {new Date(alert.openedAt).toLocaleString()}</li>)}</ul>}
        <p className="root-ops__muted">Provider health: not assessed here. {diagnostics.providerHealth.note} Module checks run from each module&apos;s Root page and <a href="/root/operations">Operations</a>.</p>
      </>}
    </section>
  </div></RootFrame>;
}
