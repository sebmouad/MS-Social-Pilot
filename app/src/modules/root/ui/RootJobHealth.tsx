import { formatRootTimestamp } from '@/lib/root-time';
import { requireRootPage } from '@/server/config/access';
import { loadRootOperations } from '@/server/root/operations';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_JOBS_COPY } from '@/lib/config/root-jobs-copy';

export async function RootJobHealth({ moduleId }: { moduleId?: string } = {}) {
  const actor = await requireRootPage();
  const copy = await runtimeConfig('root.jobsCopy').catch(() => ROOT_JOBS_COPY);
  let health: Awaited<ReturnType<typeof loadRootOperations>>;
  try { health = await loadRootOperations(actor.id, moduleId); }
  catch { return <section className="root-jobs" role="alert"><h2>{copy.unavailableTitle}</h2><p>{copy.unavailableBody}</p></section>; }
  if (!health.jobs.length) return null;
  return <section className="root-jobs" aria-label={copy.sectionLabel}>
    <p className="root-jobs__eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2>
    <p>{health.enabled ? copy.enabled : copy.disabled} · {health.worker.state === 'fresh' ? copy.freshHeartbeat : health.worker.state === 'stale' ? copy.staleHeartbeat : copy.noHeartbeat}{health.worker.seenAt ? ` · ${formatRootTimestamp(health.worker.seenAt, health.timeZone)}` : ''}.</p>
    <p>{copy.sharedHistory}</p>
    <ul className="root-jobs__latest">{health.jobs.map(job => { const run = health.runs.find(item => item.job === job.name); return <li key={job.name}><strong>{job.label}</strong><span>{run ? run.outcome === 'ok' ? copy.latestSucceeded : run.outcome === 'failed' ? copy.latestFailed : copy.latestUnknown : copy.noWindowAttempt}</span></li>; })}</ul>
    <h3>{copy.recentAttempts}</h3>{health.runs.length ? <div className="root-jobs__table-wrap"><table><caption>{copy.caption}</caption><thead><tr><th scope="col">{copy.job}</th><th scope="col">{copy.started}</th><th scope="col">{copy.result}</th><th scope="col">{copy.attempts}</th><th scope="col">{copy.duration}</th></tr></thead><tbody>{health.runs.map(run => <tr key={run.id}><td>{health.jobs.find(job => job.name === run.job)?.label ?? run.job}</td><td>{formatRootTimestamp(run.startedAt, health.timeZone)}</td><td>{run.outcome === 'ok' ? copy.latestSucceeded : run.outcome === 'failed' ? copy.latestFailed : copy.latestUnknown}{run.hasError ? ` · ${copy.errorRecorded}` : ''}</td><td>{run.attempts}</td><td>{run.durationMs === null ? copy.inProgress : `${run.durationMs}ms`}</td></tr>)}</tbody></table></div> : <p>{copy.noAttempts}</p>}
  </section>;
}
