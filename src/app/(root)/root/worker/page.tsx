import { getFormatter, getTranslations } from 'next-intl/server';

import { AppCheckButton } from '@/components/AppCheckButton';
import { requireRoot } from '@/lib/auth';
import { BACKGROUND_USAGE_CEILING as CEILING } from '@/lib/facebook/budget';
import { loadBudget } from '@/lib/facebook/budget-store';
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

  const [heartbeats, runs, saved] = await Promise.all([
    prisma.workerHeartbeat.findMany({ orderBy: { seenAt: 'desc' } }),
    prisma.workerJobRun.findMany({ orderBy: { name: 'asc' } }),
    loadBudget(),
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

  const app = saved?.snapshot.app;
  const objects = (saved?.snapshot.objects ?? []).sort((a, b) => b.percent - a.percent);
  const ids = objects.map((object) => object.id);
  const [targets, adAccounts, instagram] = ids.length
    ? await Promise.all([
        prisma.target.findMany({ where: { providerId: { in: ids } }, select: { providerId: true, name: true } }),
        prisma.adAccount.findMany({ where: { actId: { in: ids.map((id) => `act_${id}`) } }, select: { actId: true, name: true } }),
        prisma.instagramAccount.findMany({ where: { igUserId: { in: ids } }, select: { igUserId: true, username: true } }),
      ])
    : [[], [], []];
  const names = new Map<string, string>([
    ...targets.map((target) => [target.providerId, target.name] as [string, string]),
    ...adAccounts.map((account) => [account.actId.replace(/^act_/, ''), account.name] as [string, string]),
    ...instagram.map((account) => [account.igUserId, `@${account.username}`] as [string, string]),
  ]);

  const when = (at: Date | number | null) => (at === null ? '—' : format.relativeTime(new Date(at), now));
  const meter = (percent: number) => (percent >= 90 ? 'bg-red-500' : percent >= CEILING ? 'bg-amber-500' : 'bg-emerald-500');

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

      <section className="card space-y-4 p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{t('usageTitle')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('usageHint', { ceiling: CEILING })}</p>
        </div>
        {!saved || !app ? (
          <p className="text-sm text-slate-600">{t('usageNone')}</p>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">{t('appUsage')}</dt>
                <dd className="nums text-lg font-semibold text-slate-900">
                  {app.percent === null ? t('notReported') : `${Math.round(app.percent)}%`}
                </dd>
                {app.percent !== null && (
                  <div className="mt-1 h-1.5 rounded-full bg-slate-200" aria-hidden>
                    <div className={`h-1.5 rounded-full ${meter(app.percent)}`} style={{ width: `${Math.min(100, app.percent)}%` }} />
                  </div>
                )}
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('callsLastHour')}</dt>
                <dd className="nums text-lg font-semibold text-slate-900">{format.number(app.callsLastHour)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('throttle')}</dt>
                <dd className={`text-sm font-semibold ${app.throttledUntil && app.throttledUntil > now ? 'text-red-700' : 'text-emerald-700'}`}>
                  {app.throttledUntil && app.throttledUntil > now ? t('throttledUntil', { when: when(app.throttledUntil) }) : t('notThrottled')}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">{t('savedAt', { when: when(saved.savedAt) })}</p>

            {objects.length > 0 && (
              <div className="scroll-x">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <caption className="sr-only">{t('objectsTitle')}</caption>
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th scope="col" className="py-1.5 pr-3 font-medium">{t('object')}</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">{t('objectUsage')}</th>
                      <th scope="col" className="py-1.5 font-medium">{t('objectState')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {objects.map((object) => {
                      const blocked = object.blockedUntil !== null && object.blockedUntil > now;
                      return (
                        <tr key={object.id}>
                          <td className="py-1.5 pr-3 text-slate-900">
                            {names.get(object.id) ?? <span className="font-mono text-xs">{object.id}</span>}
                          </td>
                          <td className="nums py-1.5 pr-3">{Math.round(object.percent)}%</td>
                          <td className={`py-1.5 ${blocked ? 'text-red-700' : 'text-slate-600'}`}>
                            {blocked ? t('blockedUntil', { when: when(object.blockedUntil) }) : t('reading')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('appTitle')}</h2>
        <AppCheckButton />
      </section>

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
