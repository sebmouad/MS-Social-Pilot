import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { StatTile } from '@/components/charts/StatTile';
import type { PinnedFigure } from '@/lib/pinned-metrics';
import { appLocale } from '@/lib/time';
import { compact } from '@/lib/viz';

/** The metrics this person pinned from Overview, over the same window and profiles. */
export async function PinnedTiles({ figures, overviewHref }: { figures: PinnedFigure[]; overviewHref: string }) {
  if (figures.length === 0) return null;
  const t = await getTranslations('pinnedTiles');
  const locale = appLocale();

  return (
    <section aria-label={t('title')} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{t('title')}</h2>
        <Link href={overviewHref} className="text-xs font-semibold text-brand-700 hover:underline">
          {t('edit')}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {figures.map((figure) => (
          <StatTile
            key={figure.key}
            label={figure.label}
            value={
              figure.value !== null && figure.unique && figure.profiles > 1
                ? t('upTo', { value: compact(figure.value, locale) })
                : figure.value
            }
            definition={
              figure.unique && figure.profiles > 1
                ? `${figure.description} ${t('uniqueNote', { count: figure.profiles })}`
                : figure.description
            }
          />
        ))}
      </div>
    </section>
  );
}
