import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { AlertTestButton } from '@/components/AlertTestButton';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.alerts.title');
}

/** What is broken now, what broke recently, and where alerts are sent. */
export default async function RootAlertsPage() {
  await requireRoot();
  const t = await getTranslations('root.alerts');
  const tAlerts = await getTranslations('alerts');
  const format = await getFormatter();
  const incidents = await prisma.systemAlert.findMany({ orderBy: { openedAt: 'desc' }, take: 50 });
  const open = incidents.filter((incident) => !incident.resolvedAt);
  const params = (detail: unknown) =>
    Object.fromEntries(Object.entries((detail ?? {}) as Record<string, unknown>).map(([key, value]) => [key, String(value)]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('openNow', { count: open.length })}</h2>
        {open.length === 0 ? (
          <p className="text-sm text-emerald-700">{t('allClear')}</p>
        ) : (
          <ul className="space-y-2">
            {open.map((incident) => (
              <li key={incident.id} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
                <p className="font-semibold text-red-800">{tAlerts(`${incident.key.replace('.', '_')}.title`)}</p>
                <p className="text-red-700">{tAlerts(`${incident.key.replace('.', '_')}.body`, params(incident.detail))}</p>
                <p className="mt-1 text-xs text-red-600">{t('since', { when: format.relativeTime(incident.openedAt) })}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('whereTitle')}</h2>
        <p className="text-sm text-slate-600">
          {t('whereHint')}{' '}
          <Link href="/root/config" className="font-semibold text-brand-600 hover:underline">{t('whereLink')}</Link>
        </p>
        <AlertTestButton />
      </section>

      {incidents.length > open.length && (
        <section className="card p-0">
          <h2 className="px-4 pt-4 text-sm font-semibold text-slate-900">{t('history')}</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {incidents
              .filter((incident) => incident.resolvedAt)
              .map((incident) => (
                <li key={incident.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                  <span className="min-w-0 text-slate-900">{tAlerts(`${incident.key.replace('.', '_')}.title`)}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {format.dateTime(incident.openedAt, { dateStyle: 'medium', timeStyle: 'short' })} →{' '}
                    {format.dateTime(incident.resolvedAt!, { timeStyle: 'short' })}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
