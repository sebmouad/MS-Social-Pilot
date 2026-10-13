import { getFormatter, getTranslations } from 'next-intl/server';

import Link from 'next/link';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.worker.title');
}

/** A worker is alive when it wrote a heartbeat in the last five minutes, as the alert counts it. */
const ALIVE_MS = 5 * 60 * 1000;

const OUTCOME_STYLE: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-800',
  idle: 'bg-slate-100 text-slate-700',
  waiting: 'bg-amber-50 text-amber-800',
  failed: 'bg-red-50 text-red-800',
};

/**
 * What the background worker does without anyone pressing a button: whether
 * it runs, how each job went, and how much of Meta's call allowance it uses.
 */
export default async function RootWorkerPage() {
  await requireRoot();
  const t = await getTranslations('root.worker');
  const format = await getFormatter();
  const now = Date.now();

  const [heartbeats, runs] = await Promise.all([
    prisma.workerHeartbeat.findMany({ orderBy: { seenAt: 'desc' } }),
    prisma.workerJobRun.findMany({ orderBy: { name: 'asc' } }),
  ]);

  // Jobs the worker is set to run but has not run yet still get a row.
  const configured = new Set(heartbeats.flatMap((beat) => beat.jobs));
  for (const run of runs) configured.delete(run.name);
  const jobs = [
    ...runs,
    ...[...configured].sort().map((name) => ({
      name,
      finishedAt: null,
      startedAt: null,
      durationMs: null,
      outcome: null,
      summary: null,
      lastError: null,
      lastErrorAt: null,
      failures: 0,
    })),
  ];

  const when = (at: Date | number | null) => (at === null ? '—' : format.relativeTime(new Date(at), now));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('processes')}</h2>
        {heartbeats.length === 0 ? (
          <p className="text-sm text-red-700">{t('neverStarted')}</p>
        ) : (
          <ul className="space-y-2">
            {heartbeats.map((beat) => {
              const alive = now - beat.seenAt.getTime() <= ALIVE_MS;
              return (
                <li key={beat.workerId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 break-all font-mono text-xs text-slate-700">{beat.workerId}</span>
                  <span className={`badge ${alive ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                    {alive ? t('alive', { when: when(beat.seenAt) }) : t('silent', { when: when(beat.seenAt) })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-sm text-slate-600">
        <Link href="/root/meta/usage" className="font-semibold text-brand-600 hover:underline">{t('usageMoved')}</Link>
      </p>

      <section className="card p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold text-slate-900 sm:px-5">{t('jobsTitle')}</h2>
        {jobs.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-sm text-slate-600 sm:px-5">{t('jobsNone')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {jobs.map((job) => (
              <li key={job.name} className="space-y-1 px-4 py-3 text-sm sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-900">{t.has(`jobs.${job.name}`) ? t(`jobs.${job.name}`) : job.name}</span>
                  <span className={`badge ${OUTCOME_STYLE[job.outcome ?? ''] ?? 'bg-slate-100 text-slate-600'}`}>
                    {t(`outcome.${job.outcome ?? 'never'}` as 'outcome.never')}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {t('lastAttempt', { when: when(job.startedAt) })}
                  {job.durationMs !== null && ` · ${t('took', { seconds: Math.round(job.durationMs / 100) / 10 })}`}
                  {' · '}
                  {t('lastFinished', { when: when(job.finishedAt) })}
                </p>
                {job.summary && <p className="break-words text-slate-700">{job.summary}</p>}
                {job.lastError && (
                  <p className={`break-words text-xs ${job.failures > 0 ? 'text-red-700' : 'text-slate-500'}`}>
                    {job.failures > 0 ? t('failingNow', { count: job.failures }) : t('pastError', { when: when(job.lastErrorAt) })}{' '}
                    {job.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
