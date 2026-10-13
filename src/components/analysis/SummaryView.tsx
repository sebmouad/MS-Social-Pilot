import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/EmptyState';
import { ExternalLink } from '@/components/ExternalLink';
import { Icon, type IconName } from '@/components/Icon';
import { StatTile } from '@/components/charts/StatTile';
import { comparePages } from '@/lib/page-analysis-data';
import { channelChanges, combinedFindings, summaryFigures, sumSeries, type SummaryKpiKey } from '@/lib/analytics-summary';
import type { CompareMode } from '@/lib/date-range';
import { BLOCK_HOURS, MIN_POSTS_PER_SLOT, bestTimes, type Finding } from '@/lib/page-analysis';
import { formatInZone } from '@/lib/time';
import { VIZ, compact } from '@/lib/viz';
import { findingWords, weekdayNames } from './PageAnalysisView';
import { SummaryTrend } from './SummaryTrend';
import { TimeHeatmap } from './TimeHeatmap';

const TONE: Record<Finding['tone'], { icon: IconName; className: string }> = {
  good: { icon: 'check', className: 'text-emerald-700' },
  warning: { icon: 'warning', className: 'text-amber-600' },
  info: { icon: 'sparkles', className: 'text-brand-600' },
};

/**
 * The analytics Summary: what changed, the headline figures against the
 * comparison window, the trend, and the three things people look for next —
 * best posts, which channel moved, when to post. One channel or many; totals
 * follow the rules in `aggregate.ts`. Stored figures only: no Graph calls.
 */
export async function SummaryView({
  workspaceId,
  targetIds,
  from,
  to,
  days,
  timeZone,
  compare,
  rangeQuery,
  reportHref,
}: {
  workspaceId: string;
  targetIds: string[];
  from: Date;
  to: Date;
  days: number;
  timeZone: string;
  compare: CompareMode;
  rangeQuery: string;
  reportHref: string;
}) {
  const t = await getTranslations('analyticsSummary');
  const tAnalysis = await getTranslations('pageAnalysis');
  const locale = await getLocale();
  const rows = await comparePages({ workspaceId, from, to, timeZone, compare, targetIds });

  if (rows.length === 0) return <EmptyState title={t('none')} />;

  const figures = summaryFigures(rows);
  const said = combinedFindings(rows);
  const longDays = weekdayNames(locale, 'long');
  const shortDays = weekdayNames(locale, 'short');
  const vs = compare === 'year' ? t('vsYear') : t('vsPrevious', { days });
  const several = rows.length > 1;
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString(locale)}`;

  const valueOf = (key: SummaryKpiKey, value: number | null): string | number | null => {
    if (value === null) return null;
    if (key === 'rate') return `${value}%`;
    if (key === 'reach' && figures.reachIsUpperBound) return t('upTo', { value: compact(value, locale) });
    return value;
  };

  const noteOf = (key: SummaryKpiKey): string => {
    if (key === 'followers') {
      if (figures.netFollows === null) return t('meaning.followers');
      const parts =
        figures.follows !== null || figures.unfollows !== null
          ? t('followersParts', { gained: figures.follows ?? 0, lost: figures.unfollows ?? 0 })
          : '';
      return `${t('followersNet', { net: signed(figures.netFollows) })}${parts ? ` · ${parts}` : ''}`;
    }
    if (key === 'reach' && figures.reachIsUpperBound) return t('meaning.reachSeveral');
    return t(`meaning.${key}`);
  };

  const best = rows
    .flatMap((row) => row.top.map((post) => ({ post, channel: row.name })))
    .sort((a, b) => b.post.interactions - a.post.interactions)
    .slice(0, 3);
  const moves = channelChanges(rows);
  const times = bestTimes(
    rows.flatMap((row) => row.postList),
    timeZone,
  );

  const trendDays = rows[0]!.daily.days;
  const series = (pick: (row: (typeof rows)[number]) => { posts: number[]; interactions: number[]; reach: number[] }) => ({
    reach: sumSeries(rows.map((row) => pick(row).reach)),
    interactions: sumSeries(rows.map((row) => pick(row).interactions)),
    posts: sumSeries(rows.map((row) => pick(row).posts)),
  });

  return (
    <div className="space-y-6">
      {said.length > 0 && (
        <section className="card-viz" aria-labelledby="summary-changed">
          <h2 id="summary-changed" className="text-sm font-semibold text-slate-900">
            {t('changed')}
          </h2>
          <ul className="mt-3 space-y-2.5">
            {said.map(({ finding, channels }, index) => (
              <li key={`${finding.key}-${index}`} className="flex gap-2.5 text-sm text-slate-700">
                <span className={`mt-0.5 shrink-0 ${TONE[finding.tone].className}`}>
                  <Icon name={TONE[finding.tone].icon} size={16} />
                </span>
                <span>
                  {channels.length > 0 && <span className="font-semibold text-slate-900">{channels.join(', ')}: </span>}
                  {tAnalysis(`findings.${finding.key}`, findingWords(tAnalysis, finding, longDays))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={t('figures')}>
        {several && <p className="mb-2 text-sm text-slate-600">{t('intro', { count: rows.length, days })}</p>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {figures.kpis.map((kpi) => (
            <StatTile
              key={kpi.key}
              label={t(`kpi.${kpi.key}`)}
              value={valueOf(kpi.key, kpi.current)}
              delta={kpi.change}
              deltaLabel={vs}
              note={noteOf(kpi.key)}
            />
          ))}
        </div>
      </section>

      <SummaryTrend
        days={trendDays}
        current={series((row) => row.daily)}
        previous={series((row) => row.previous.daily)}
        previousLabel={compare === 'year' ? t('trend.lastYear') : t('trend.previous', { days })}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card-viz">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">{t('bestPosts')}</h2>
            <Link href={`/analytics?view=posts&${rangeQuery}`} className="text-xs font-semibold text-brand-700 hover:underline">
              {t('allPosts')}
            </Link>
          </div>
          {best.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">{t('noPosts')}</p>
          ) : (
            <ol className="mt-2 divide-y divide-slate-100">
              {best.map(({ post, channel }, index) => (
                <li key={post.id} className="flex items-start gap-3 py-2.5 text-sm">
                  <span className="nums w-5 shrink-0 text-end text-slate-400">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-slate-800">{post.message || tAnalysis('post.noText')}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {several && `${channel} · `}
                      {formatInZone(post.publishedAt, timeZone, 'd MMM')}
                      {post.url && (
                        <>
                          {' · '}
                          <ExternalLink href={post.url} className="font-semibold text-brand-600 hover:underline">
                            {tAnalysis('post.open')}
                          </ExternalLink>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="nums shrink-0 font-semibold text-slate-900">
                    {t('interactionCount', { count: post.interactions })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card-viz">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">{t('channels')}</h2>
            <Link href={`/analytics?view=compare&${rangeQuery}`} className="text-xs font-semibold text-brand-700 hover:underline">
              {t('compareChannels')}
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-slate-100">
            {moves.map((move) => (
              <li key={move.targetId} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{move.name}</span>
                <span className="text-xs text-slate-500">
                  {t(`channelFigure.${move.figure}`, { value: move.current === null ? '—' : compact(move.current, locale) })}
                </span>
                {move.change === null ? (
                  <span className="whitespace-nowrap text-end text-xs text-slate-400">{t('noChange')}</span>
                ) : (
                  // Arrow and colour: the direction never rests on colour alone.
                  <span
                    className="nums w-16 text-end text-xs font-semibold"
                    style={{ color: move.change >= 0 ? VIZ.goodText : VIZ.critical }}
                  >
                    {move.change >= 0 ? '▲' : '▼'} {Math.abs(move.change)}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-label={t('whenToPost')}>
        <TimeHeatmap
          cells={times.cells}
          best={times.best}
          weekdays={shortDays}
          blockHours={BLOCK_HOURS}
          minPosts={MIN_POSTS_PER_SLOT}
          timeZone={timeZone}
        />
      </section>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Link href={`/analytics?view=overview&${rangeQuery}`} className="font-semibold text-brand-700 hover:underline">
          {t('rawFigures')}
        </Link>
        <Link href={reportHref} className="font-semibold text-brand-700 hover:underline">
          {t('report')}
        </Link>
      </p>
    </div>
  );
}
