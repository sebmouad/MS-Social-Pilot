import { ScreenHeader } from '@/components/ScreenHeader';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';

import { AutoRefresh } from '@/components/AutoRefresh';
import { ExportButton } from '@/components/ExportButton';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { EXPORT_DAYS } from '@/lib/workspace-export';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('workspaceExport.title');
}

const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-700',
  building: 'bg-amber-50 text-amber-800',
  ready: 'bg-emerald-50 text-emerald-800',
  failed: 'bg-red-50 text-red-800',
  expired: 'bg-slate-100 text-slate-500',
};

/**
 * Export everything (NEXT_PHASES G17): the workspace owner asks for a ZIP of
 * posts, schedule, analytics, comments and media; the worker builds it and the
 * download stays available for a week.
 */
export default async function ExportPage() {
  const auth = await requirePage();
  if (auth.role !== 'owner') notFound();
  const t = await getTranslations('workspaceExport');
  const format = await getFormatter();
  const exports = await prisma.workspaceExport.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  const pending = exports.some((entry) => entry.status === 'queued' || entry.status === 'building');
  const now = new Date();

  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('intro', { days: EXPORT_DAYS })} />

      <section className="card space-y-3 p-4 sm:p-5">
        <ul className="list-disc space-y-1 ps-5 text-sm text-slate-700">
          <li>{t('contentsPosts')}</li>
          <li>{t('contentsSchedule')}</li>
          <li>{t('contentsAnalytics')}</li>
          <li>{t('contentsComments')}</li>
          <li>{t('contentsMedia')}</li>
        </ul>
        <p className="hint">{t('noSecrets')}</p>
        <ExportButton disabled={pending} />
        {pending && <p className="text-sm text-slate-600">{t('pendingHint')}</p>}
      </section>

      {pending && <AutoRefresh seconds={10} />}

      {exports.length > 0 && (
        <section className="card divide-y divide-slate-100" aria-label={t('listTitle')}>
          {exports.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{format.dateTime(entry.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                <p className="text-xs text-slate-600">
                  {entry.status === 'ready' && entry.expiresAt
                    ? t('readyDetail', { size: format.number((entry.bytes ?? 0) / 1_048_576, { maximumFractionDigits: 1 }), when: format.relativeTime(entry.expiresAt, now) })
                    : entry.status === 'failed'
                      ? (entry.error ?? t('failedDetail'))
                      : null}
                  {entry.skippedMedia > 0 && ` ${t('skipped', { count: entry.skippedMedia })}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${STATUS_STYLE[entry.status] ?? STATUS_STYLE.queued}`}>{t(`status.${entry.status as 'queued'}`)}</span>
                {entry.status === 'ready' && (
                  <a className="btn-secondary" href={`/api/exports/${entry.id}`} download>
                    {t('download')}
                  </a>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
