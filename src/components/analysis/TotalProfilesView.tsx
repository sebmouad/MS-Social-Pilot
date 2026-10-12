import { EmptyState } from '@/components/EmptyState';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { StatTile } from '@/components/charts/StatTile';
import { comparePages, type PageComparisonRow } from '@/lib/page-analysis-data';
import { topBy, totalProfiles } from '@/lib/aggregate';
import type { CompareMode } from '@/lib/date-range';
import { appLocale } from '@/lib/time';
import { compact } from '@/lib/viz';

/**
 * Several profiles at once, added up by the rules in `src/lib/aggregate.ts`:
 * the selection's headline figures, then which profiles lead and which grow.
 * Stored figures only, so opening it makes no Graph calls.
 */
export async function TotalProfilesView({
  workspaceId,
  from,
  to,
  days,
  timeZone,
  compare,
  targetIds,
  rangeQuery,
}: {
  workspaceId: string;
  from: Date;
  to: Date;
  days: number;
  timeZone: string;
  compare: CompareMode;
  /** The selected profiles; every Page when absent. */
  targetIds?: string[];
  rangeQuery: string;
}) {
  const t = await getTranslations('totalView');
  const locale = appLocale();
  const rows = await comparePages({ workspaceId, from, to, timeZone, compare, targetIds });

  if (rows.length === 0) {
    return <EmptyState title={t('none')} />;
  }

  const total = totalProfiles(rows);
  const signed = (value: number | null) =>
    value === null ? null : `${value > 0 ? '+' : ''}${value.toLocaleString(locale)}`;

  const ranking = (title: string, ranked: PageComparisonRow[], figure: (row: PageComparisonRow) => string) => (
    <section className="card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {ranked.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{t('noRanking')}</p>
      ) : (
        <ol className="mt-2 divide-y divide-slate-100">
          {ranked.map((row, index) => (
            <li key={row.targetId} className="flex items-center gap-3 py-2 text-sm">
              <span className="nums w-5 text-end text-slate-400">{index + 1}</span>
              <Link
                href={`/analytics?view=analysis&target=${row.targetId}&${rangeQuery}`}
                className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:text-brand-700 hover:underline"
              >
                {row.name}
              </Link>
              <span className="nums font-semibold text-slate-700">{figure(row)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('intro', { count: total.profiles, days })}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label={t('followers')} value={total.followers} definition={t('followersHelp')} />
        <StatTile label={t('netFollows')} value={signed(total.netFollows)} definition={t('netFollowsHelp')} />
        <StatTile label={t('posts')} value={total.posts} definition={t('postsHelp')} />
        <StatTile label={t('interactions')} value={total.interactions} definition={t('interactionsHelp')} />
        <StatTile label={t('perPost')} value={total.interactionsPerPost} definition={t('perPostHelp')} />
        <StatTile
          label={t('reach')}
          value={total.reachUpTo === null ? null : t('upTo', { value: compact(total.reachUpTo, locale) })}
          definition={t('reachHelp', { count: total.reachProfiles })}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {ranking(
          t('topInteractions'),
          topBy(rows, (row) => row.interactions || null),
          (row) => compact(row.interactions, locale),
        )}
        {ranking(
          t('topGrowth'),
          topBy(rows, (row) => row.netFollows),
          (row) => signed(row.netFollows) ?? '—',
        )}
      </div>
      <p className="text-xs text-slate-500">
        <Link href={`/analytics?view=compare&${rangeQuery}`} className="font-semibold text-brand-700 hover:underline">
          {t('seeTable')}
        </Link>
      </p>
    </div>
  );
}
