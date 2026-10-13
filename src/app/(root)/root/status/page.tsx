import { getFormatter, getTranslations } from 'next-intl/server';

import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { loadUptime, UPTIME_COMPONENTS, UPTIME_DAYS } from '@/lib/uptime';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.status.title');
}

const WORKER_FRESH_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function barColour(share: number | null) {
  if (share === null) return 'bg-slate-200';
  if (share >= 0.999) return 'bg-emerald-500';
  if (share >= 0.95) return 'bg-amber-500';
  return 'bg-red-500';
}

/**
 * The installation's status at a glance: app, database,
 * worker, last publish and last backup now, and 90 days of uptime. Root only.
 */
export default async function RootStatusPage() {
  await requireRoot();
  const t = await getTranslations('root.status');
  const format = await getFormatter();
  const now = Date.now();

  const started = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  const databaseMs = Math.round(performance.now() - started);

  const [heartbeat, lastPublish, lastFailure, lastBackup, uptime] = await Promise.all([
    prisma.workerHeartbeat.findFirst({ orderBy: { seenAt: 'desc' }, select: { seenAt: true } }),
    prisma.postTarget.findFirst({ where: { publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
    prisma.postTarget.findFirst({ where: { status: 'failed' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.backupRun.findFirst({ where: { kind: 'offsite', status: 'ok' }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } }),
    loadUptime(now),
  ]);

  const when = (at: Date | null | undefined) => (at ? format.relativeTime(at, new Date(now)) : t('never'));
  const workerOk = heartbeat !== null && now - heartbeat.seenAt.getTime() < WORKER_FRESH_MS;
  const backupOk = lastBackup !== null && now - lastBackup.finishedAt.getTime() <= 2 * DAY_MS;
  const percent = (share: number | null) => (share === null ? '—' : format.number(share, { style: 'percent', maximumFractionDigits: 2 }));

  const rows = [
    { label: t('app'), ok: true, detail: t('appOk') },
    { label: t('database'), ok: true, detail: t('databaseOk', { ms: databaseMs }) },
    { label: t('worker'), ok: workerOk, detail: heartbeat ? t('lastBeat', { when: when(heartbeat.seenAt) }) : t('workerNever') },
    {
      label: t('lastPublish'),
      ok: null,
      detail: lastFailure ? t('publishDetail', { published: when(lastPublish?.publishedAt), failed: when(lastFailure.updatedAt) }) : when(lastPublish?.publishedAt),
    },
    { label: t('lastBackup'), ok: backupOk, detail: lastBackup ? when(lastBackup.finishedAt) : t('backupNever') },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <section className="card divide-y divide-slate-100" aria-label={t('now')}>
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span className="font-medium text-slate-900">{row.label}</span>
            <span className="flex items-center gap-2 text-slate-700">
              {row.detail}
              {row.ok !== null && (
                <span className={`badge ${row.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                  {row.ok ? t('ok') : t('problem')}
                </span>
              )}
            </span>
          </div>
        ))}
      </section>

      <section className="card space-y-4 p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{t('uptimeTitle', { days: UPTIME_DAYS })}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('uptimeHint')}</p>
        </div>
        {UPTIME_COMPONENTS.map((component) => (
          <div key={component}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-slate-800">{t(component)}</span>
              <span className="nums text-slate-700">{percent(uptime.overall[component])}</span>
            </div>
            <ol className="mt-1.5 flex h-8 gap-px" aria-label={t('uptimeOf', { name: t(component) })}>
              {uptime.days.map((day) => {
                const label = `${format.dateTime(new Date(`${day.day}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })}: ${
                  day[component] === null ? t('noData') : percent(day[component])
                }`;
                return <li key={day.day} className={`min-w-0 flex-1 rounded-sm ${barColour(day[component])}`} title={label} aria-label={label} />;
              })}
            </ol>
          </div>
        ))}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />{t('legendFull')}</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />{t('legendSome')}</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" />{t('legendDown')}</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" />{t('noData')}</span>
        </p>
      </section>
    </div>
  );
}
