import { getFormatter, getTranslations } from 'next-intl/server';

import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { listRootActivity } from '@/lib/root';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.activity.title');
}

/** What root has done to the installation, newest first. Shown nowhere else. */
export default async function RootActivityPage() {
  await requireRoot();
  const t = await getTranslations('root');
  const format = await getFormatter();
  const entries = await listRootActivity();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('activity.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('activity.subtitle')}</p>
      </header>
      {entries.length === 0 ? (
        <p className="card p-6 text-sm text-slate-600">{t('activity.empty')}</p>
      ) : (
        <ol className="card divide-y divide-slate-100 p-0">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
              <span className="min-w-0 text-slate-900">
                {t(`activity.actions.${entry.action.replace('.', '_')}`, Object.fromEntries(
                  Object.entries(entry.detail).map(([key, value]) => [key, String(value)]),
                ))}
                {entry.actor && <span className="text-slate-500"> · {entry.actor}</span>}
              </span>
              <time className="shrink-0 text-xs text-slate-500" dateTime={entry.createdAt}>
                {format.dateTime(new Date(entry.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
