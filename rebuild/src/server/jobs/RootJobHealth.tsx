import { prisma } from '@/server/data';

type Run = { id: string; job: string; owner: string; startedAt: Date; finishedAt: Date | null; outcome: string; attempts: number; summary: string | null; error: string | null };
type Latest = { name: string; finishedAt: Date | null; outcome: string | null; summary: string | null; lastError: string | null; failures: number };
type Heartbeat = { workerId: string; seenAt: Date; jobs: string[] | null };

export async function RootJobHealth() {
  let runs: Run[] = [];
  let latest: Latest[] = [];
  let heartbeat: Heartbeat | null = null;
  let unavailable = false;
  try {
    const [runRows, latestRows, heartbeatRows] = await Promise.all([
      prisma.$queryRaw<Run[]>`SELECT id, job, owner, "startedAt", "finishedAt", outcome, attempts, summary, error FROM rebuild_sync_runs ORDER BY "startedAt" DESC LIMIT 15`,
      prisma.$queryRaw<Latest[]>`SELECT name, "finishedAt", outcome, summary, "lastError", failures FROM worker_job_runs WHERE name IN ('posts', 'analytics', 'inbox') ORDER BY name`,
      prisma.$queryRaw<Heartbeat[]>`SELECT "workerId", "seenAt", jobs FROM worker_heartbeats ORDER BY "seenAt" DESC LIMIT 1`,
    ]);
    runs = runRows; latest = latestRows; heartbeat = heartbeatRows[0] ?? null;
  } catch {
    unavailable = true;
  }
  return <section className="root-jobs" aria-labelledby="root-jobs-title">
    <p className="root-jobs__eyebrow">Operations</p>
    <h2 id="root-jobs-title">Background sync health</h2>
    {unavailable ? <p>The worker health tables are unavailable. Apply the rebuild worker migration before starting the worker.</p> : <>
      <p className="root-jobs__status">{heartbeat ? `Latest worker heartbeat: ${heartbeat.seenAt.toLocaleString()} (${heartbeat.workerId})` : 'No worker heartbeat recorded.'}</p>
      {latest.length > 0 && <ul className="root-jobs__latest">{latest.map(item => <li key={item.name}>
        <strong>{item.name}</strong><span>{item.outcome ?? 'no runs yet'}{item.finishedAt ? ` · ${item.finishedAt.toLocaleString()}` : ''}</span>
        {item.failures > 0 && <span>{item.failures} consecutive failed run(s)</span>}
        {item.lastError && <small>{item.lastError}</small>}
      </li>)}</ul>}
      <h3>Recent attempts</h3>
      {runs.length ? <div className="root-jobs__table-wrap"><table><thead><tr><th>Job</th><th>Started</th><th>Result</th><th>Attempts</th><th>Details</th></tr></thead><tbody>{runs.map(run => <tr key={run.id}>
        <td>{run.job}</td><td>{run.startedAt.toLocaleString()}</td><td>{run.outcome}</td><td>{run.attempts}</td><td>{run.error ?? run.summary ?? '—'}</td>
      </tr>)}</tbody></table></div> : <p>No job attempts recorded.</p>}
    </>}
  </section>;
}
