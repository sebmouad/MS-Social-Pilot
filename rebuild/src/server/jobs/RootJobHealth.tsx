import { formatRootTimestamp } from '@/lib/root-time';
import { requireRootPage } from '@/server/config/access';
import { loadRootOperations } from '@/server/root/operations';

export async function RootJobHealth({ moduleId }: { moduleId?: string } = {}) {
  const actor = await requireRootPage();
  let health: Awaited<ReturnType<typeof loadRootOperations>>;
  try { health = await loadRootOperations(actor.id, moduleId); }
  catch { return <section className="root-jobs" role="alert"><h2>Background work unavailable</h2><p>Worker health could not be loaded. Check database and service availability, then reload.</p></section>; }
  if (!health.jobs.length) return null;
  return <section className="root-jobs" aria-label="Replacement background work">
    <p className="root-jobs__eyebrow">Operations</p><h2>Background work</h2>
    <p>{health.enabled ? 'Execution enabled' : 'Execution disabled'} · {health.worker.state === 'fresh' ? 'Recent replacement-worker heartbeat' : health.worker.state === 'stale' ? 'Replacement-worker heartbeat is stale' : 'No replacement-worker heartbeat'}{health.worker.seenAt ? ` · ${formatRootTimestamp(health.worker.seenAt, health.timeZone)}` : ''}.</p>
    <p>Only replacement job history is shown. Shared jobs may cover several platforms; this is not platform-specific API health.</p>
    <ul className="root-jobs__latest">{health.jobs.map(job => { const run = health.runs.find(item => item.job === job.name); return <li key={job.name}><strong>{job.label}</strong><span>{run ? run.outcome === 'ok' ? 'Latest attempt succeeded' : run.outcome === 'failed' ? 'Latest attempt failed' : 'Latest outcome unknown' : 'No attempt in this history window'}</span></li>; })}</ul>
    <h3>Recent attempts</h3>{health.runs.length ? <div className="root-jobs__table-wrap"><table><caption>Replacement job attempts</caption><thead><tr><th scope="col">Job</th><th scope="col">Started</th><th scope="col">Result</th><th scope="col">Attempts</th><th scope="col">Duration</th></tr></thead><tbody>{health.runs.map(run => <tr key={run.id}><td>{health.jobs.find(job => job.name === run.job)?.label ?? run.job}</td><td>{formatRootTimestamp(run.startedAt, health.timeZone)}</td><td>{run.outcome}{run.hasError ? ' · error recorded; inspect service logs securely' : ''}</td><td>{run.attempts}</td><td>{run.durationMs === null ? 'In progress' : `${run.durationMs}ms`}</td></tr>)}</tbody></table></div> : <p>No recorded attempts.</p>}
  </section>;
}
