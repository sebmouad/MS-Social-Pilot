import { formatRootTimestamp } from '@/lib/root-time';
import { requireRootPage } from '@/server/config/access';
import { loadRootOperations } from '@/server/root/operations';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_JOBS_COPY } from '@/lib/config/root-jobs-copy';

/** 17837 → « 18 s »: a duration a person reads at a glance. */
const duration = (ms: number) => ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;

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
    <ul className="root-jobs__latest">{health.jobs.map(job => { const run = health.runs.find(item => item.job === job.name); return <li key={job.name} data-state={run ? run.outcome === 'ok' ? 'ok' : run.outcome === 'failed' ? 'failed' : 'unknown' : 'idle'}><strong>{job.label}</strong><span>{run ? run.outcome === 'ok' ? copy.latestSucceeded : run.outcome === 'failed' ? copy.latestFailed : copy.latestUnknown : copy.noWindowAttempt}</span></li>; })}</ul>
    <h3>{copy.recentAttempts}</h3>{health.runs.length ? <div className="root-jobs__table-wrap" tabIndex={0} role="region" aria-label={copy.caption}><table><caption>{copy.caption}</caption><thead><tr><th scope="col">{copy.job}</th><th scope="col">{copy.started}</th><th scope="col">{copy.result}</th><th scope="col">{copy.attempts}</th><th scope="col">{copy.duration}</th></tr></thead><tbody>{health.runs.map(run => <tr key={run.id}><td>{health.jobs.find(job => job.name === run.job)?.label ?? run.job}</td><td>{formatRootTimestamp(run.startedAt, health.timeZone)}</td><td><span className={`ui-badge ui-badge--${run.outcome === 'ok' ? 'success' : run.outcome === 'failed' ? 'danger' : 'neutral'}`}>{run.outcome === 'ok' ? copy.latestSucceeded : run.outcome === 'failed' ? copy.latestFailed : copy.latestUnknown}</span>{run.hasError ? ` ${copy.errorRecorded}` : ''}</td><td>{run.attempts}</td><td>{run.durationMs === null ? copy.inProgress : duration(run.durationMs)}</td></tr>)}</tbody></table></div> : <p>{copy.noAttempts}</p>}
  </section>;
}
