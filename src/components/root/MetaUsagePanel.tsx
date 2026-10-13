import { getFormatter, getTranslations } from 'next-intl/server';

import { BACKGROUND_USAGE_CEILING as CEILING } from '@/lib/facebook/budget';
import { loadBudget } from '@/lib/facebook/budget-store';
import { prisma } from '@/lib/prisma';

/**
 * How much of Meta's call allowance the worker uses: app usage, throttling,
 * the busiest channels and jobs. Server component, root pages only.
 */
export async function MetaUsagePanel() {
  const t = await getTranslations('root.worker');
  const format = await getFormatter();
  const now = Date.now();
  const saved = await loadBudget();

  const app = saved?.snapshot.app;
  const objects = (saved?.snapshot.objects ?? []).sort((a, b) => b.percent - a.percent);
  const calls = saved?.snapshot.calls ?? { objects: [], jobs: [] };
  const heaviest = calls.objects.slice(0, 15);
  const ids = [...new Set([...objects.map((object) => object.id), ...heaviest.map((object) => object.id)])];
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
                <table className="data-table w-full min-w-[28rem] text-start text-sm">
                  <caption className="sr-only">{t('objectsTitle')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="py-1.5 pe-3 font-medium">{t('object')}</th>
                      <th scope="col" className="py-1.5 pe-3 font-medium">{t('objectUsage')}</th>
                      <th scope="col" className="py-1.5 font-medium">{t('objectState')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {objects.map((object) => {
                      const blocked = object.blockedUntil !== null && object.blockedUntil > now;
                      return (
                        <tr key={object.id}>
                          <td className="py-1.5 pe-3 text-slate-900">
                            {names.get(object.id) ?? <span className="font-mono text-xs">{object.id}</span>}
                          </td>
                          <td className="nums py-1.5 pe-3">{Math.round(object.percent)}%</td>
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

            {(heaviest.length > 0 || calls.jobs.length > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="scroll-x">
                  <table className="data-table w-full text-start text-sm">
                    <caption className="pb-1 text-start text-xs font-semibold text-slate-700">{t('heaviestObjects')}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="py-1.5 pe-3 font-medium">{t('object')}</th>
                        <th scope="col" className="py-1.5 font-medium">{t('calls')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {heaviest.map((object) => (
                        <tr key={object.id}>
                          <td className="py-1.5 pe-3 text-slate-900">{names.get(object.id) ?? <span className="font-mono text-xs">{object.id}</span>}</td>
                          <td className="nums py-1.5">{format.number(object.calls)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="scroll-x">
                  <table className="data-table w-full text-start text-sm">
                    <caption className="pb-1 text-start text-xs font-semibold text-slate-700">{t('heaviestJobs')}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="py-1.5 pe-3 font-medium">{t('job')}</th>
                        <th scope="col" className="py-1.5 font-medium">{t('calls')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {calls.jobs.map((job) => (
                        <tr key={job.name || 'other'}>
                          <td className="py-1.5 pe-3 text-slate-900">{job.name ? (t.has(`jobs.${job.name}`) ? t(`jobs.${job.name}`) : job.name) : t('otherCalls')}</td>
                          <td className="nums py-1.5">{format.number(job.calls)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </section>
  );
}
