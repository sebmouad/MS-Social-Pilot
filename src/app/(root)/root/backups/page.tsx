import { getFormatter, getTranslations } from 'next-intl/server';

import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.backups.title');
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Off-site backups and the monthly restore test, as the server's scripts
 * recorded them (scripts/server/offsite-backup.sh, restore-test.sh). A copy
 * older than two days, or a restore test older than five weeks, is a problem.
 */
export default async function RootBackupsPage() {
  await requireRoot();
  const t = await getTranslations('root.backups');
  const format = await getFormatter();
  const runs = await prisma.backupRun.findMany({ orderBy: { finishedAt: 'desc' }, take: 60 });

  const lastOk = (kind: string) => runs.find((run) => run.kind === kind && run.status === 'ok') ?? null;
  const offsite = lastOk('offsite');
  const restore = lastOk('restore_test');
  const now = Date.now();
  const tiles = [
    { label: t('lastOffsite'), run: offsite, stale: !offsite || now - offsite.finishedAt.getTime() > 2 * DAY },
    { label: t('lastRestore'), run: restore, stale: !restore || now - restore.finishedAt.getTime() > 35 * DAY },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <div key={tile.label} className={`card p-4 ${tile.stale ? 'border-amber-300' : ''}`}>
            <p className="text-[13px] font-semibold text-slate-600">{tile.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {tile.run ? format.relativeTime(tile.run.finishedAt, new Date(now)) : t('never')}
            </p>
            {tile.stale && <p className="mt-1 text-sm text-amber-800">{t('stale')}</p>}
            {tile.run?.detail && <p className="mt-1 break-words text-xs text-slate-500">{tile.run.detail}</p>}
          </div>
        ))}
      </div>

      {runs.length === 0 ? (
        <section className="card space-y-2 p-4 text-sm text-slate-700 sm:p-5">
          <h2 className="font-semibold text-slate-900">{t('setupTitle')}</h2>
          <p>{t('setupIntro')}</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t('setup1')}</li>
            <li>{t('setup2')}</li>
            <li>{t('setup3')}</li>
            <li>{t('setup4')}</li>
          </ol>
        </section>
      ) : (
        <section className="card p-0">
          <h2 className="px-4 pt-4 text-sm font-semibold text-slate-900">{t('history')}</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <span className={`badge mr-2 ${run.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {run.status === 'ok' ? t('ok') : t('failed')}
                  </span>
                  <span className="font-medium text-slate-900">{run.kind === 'offsite' ? t('kindOffsite') : t('kindRestore')}</span>
                  {run.detail && <span className="block break-words text-xs text-slate-500">{run.detail}</span>}
                </span>
                <time className="shrink-0 text-xs text-slate-500" dateTime={run.finishedAt.toISOString()}>
                  {format.dateTime(run.finishedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
