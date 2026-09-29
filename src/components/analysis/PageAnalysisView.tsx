import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { AnalyseButton } from './AnalyseButton';
import { CadenceChart } from './CadenceChart';
import { TimeHeatmap } from './TimeHeatmap';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { StatTile } from '@/components/charts/StatTile';
import { ExternalLink } from '@/components/ExternalLink';
import { Icon, type IconName } from '@/components/Icon';
import { analysePage, comparePages, type PageComparisonRow } from '@/lib/page-analysis-data';
import {
  BLOCK_HOURS,
  MIN_POSTS_PER_SLOT,
  TARGET_POSTS_PER_WEEK,
  type AnalysedPost,
  type Finding,
  type Health,
  type KpiKey,
} from '@/lib/page-analysis';
import { appLocale, formatInZone } from '@/lib/time';
import { VIZ, compact, seriesColor } from '@/lib/viz';

/** Localised weekday names, 0 = Sunday, from a known Sunday. */
function weekdayNames(locale: string, style: 'long' | 'short'): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(Date.UTC(2024, 0, 7 + day))));
}

const TONE: Record<Finding['tone'], { icon: IconName; className: string }> = {
  good: { icon: 'check', className: 'text-emerald-700' },
  warning: { icon: 'warning', className: 'text-amber-600' },
  info: { icon: 'sparkles', className: 'text-brand-600' },
};

const BAND_STYLE: Record<NonNullable<Health['band']>, { color: string; icon: IconName }> = {
  strong: { color: VIZ.goodText, icon: 'check' },
  steady: { color: 'var(--viz-ink-secondary)', icon: 'clock' },
  attention: { color: VIZ.critical, icon: 'warning' },
};

async function HealthCard({ health }: { health: Health }) {
  const t = await getTranslations('pageAnalysis');
  const band = health.band ? BAND_STYLE[health.band] : null;

  return (
    <section className="card-viz">
      <h3 className="text-sm font-semibold text-slate-900">{t('health.title')}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{t('health.hint')}</p>

      {health.score === null ? (
        <p className="py-6 text-center text-sm text-slate-500">{t('health.none')}</p>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-3">
            <p className="text-5xl font-semibold text-slate-900">
              {health.score}
              <span className="text-lg font-normal text-slate-400">/100</span>
            </p>
            {band && health.band && (
              // Status: a colour, an icon and a word — never the colour alone.
              <p className="mb-1.5 flex items-center gap-1 text-sm font-medium" style={{ color: band.color }}>
                <Icon name={band.icon} size={16} />
                {t(`health.band.${health.band}`)}
              </p>
            )}
          </div>

          <ul className="mt-4 space-y-3">
            {health.components.map((component) => (
              <li key={component.key}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-medium text-slate-700">{t(`health.component.${component.key}`)}</span>
                  <span className="nums font-semibold text-slate-900">{component.score}</span>
                </div>
                <span className="mt-1 block h-2 w-full overflow-hidden rounded-sm" style={{ background: VIZ.grid }}>
                  <span
                    className="block h-full"
                    style={{
                      width: `${Math.max(1.5, component.score)}%`,
                      background: seriesColor(0),
                      borderTopRightRadius: 4,
                      borderBottomRightRadius: 4,
                    }}
                  />
                </span>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t(`health.componentHint.${component.key}`, { target: TARGET_POSTS_PER_WEEK })}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

async function FindingsList({ findings, weekdays }: { findings: Finding[]; weekdays: string[] }) {
  const t = await getTranslations('pageAnalysis');

  // Parameters that are keys become words here, in the reader's language.
  const words = (finding: Finding): Record<string, string | number> => {
    const params = { ...finding.params };
    for (const key of ['best', 'worst', 'format'] as const) {
      if (typeof params[key] === 'string') params[key] = t(`format.${params[key]}`);
    }
    if (finding.key === 'bestTime') {
      const hour = Number(params.hour);
      params.weekday = weekdays[Number(params.weekday)] ?? '';
      params.start = `${String(hour).padStart(2, '0')}:00`;
      params.end = `${String((hour + BLOCK_HOURS) % 24).padStart(2, '0')}:00`;
    }
    return params;
  };

  return (
    <section className="card-viz">
      <h3 className="text-sm font-semibold text-slate-900">{t('findings.title')}</h3>
      {findings.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">{t('findings.none')}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {findings.map((finding) => (
            <li key={finding.key} className="flex gap-2.5 text-sm text-slate-700">
              <span className={`mt-0.5 shrink-0 ${TONE[finding.tone].className}`}>
                <Icon name={TONE[finding.tone].icon} size={16} />
              </span>
              <span>{t(`findings.${finding.key}`, words(finding))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function PostTable({
  title,
  hint,
  posts,
  timeZone,
}: {
  title: string;
  hint: string;
  posts: AnalysedPost[];
  timeZone: string;
}) {
  const t = await getTranslations('pageAnalysis');
  const ta = await getTranslations('analytics');
  if (posts.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <div className="px-4 pt-4 sm:px-5">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      </div>
      <div className="scroll-x">
        <table className="mt-3 w-full text-sm">
          <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">{ta('post')}</th>
              <th scope="col" className="px-3 py-2 text-right">{t('kpi.interactions')}</th>
              {/* Reach and rate step aside on a phone: the post and what it
                  earned are the row; the rest is one rotation away. */}
              <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">{ta('reach')}</th>
              <th scope="col" className="hidden px-4 py-2 text-right sm:table-cell">{t('post.rate')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {posts.map((post) => (
              <tr key={post.id}>
                <td className="max-w-xs px-4 py-2.5">
                  <p className="line-clamp-2 text-slate-900">{post.message || t('post.noText')}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t(`format.${post.format}`)} · {formatInZone(post.publishedAt, timeZone, 'd MMM, HH:mm')} ·{' '}
                    {post.source === 'app' ? t('post.fromApp') : t('post.fromPage')}
                    {post.url && (
                      <>
                        {' · '}
                        <ExternalLink href={post.url} className="text-brand-600 hover:underline">
                          {t('post.open')}
                        </ExternalLink>
                      </>
                    )}
                  </p>
                </td>
                <td className="nums px-4 py-2.5 text-right font-medium text-slate-900 sm:px-3">
                  {post.interactions.toLocaleString(appLocale())}
                  <span className="block text-[11px] font-normal text-slate-500">
                    {post.reactions.toLocaleString(appLocale())} · {post.comments.toLocaleString(appLocale())} · {post.shares.toLocaleString(appLocale())}
                  </span>
                </td>
                <td className="nums hidden px-3 py-2.5 text-right text-slate-700 sm:table-cell">{post.reach?.toLocaleString(appLocale()) ?? '—'}</td>
                <td className="nums hidden px-4 py-2.5 text-right text-slate-700 sm:table-cell">{post.rate !== null ? `${post.rate}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const KPI_UP_IS_GOOD: Record<KpiKey, boolean> = {
  posts: true,
  interactions: true,
  avgInteractions: true,
  medianRate: true,
  reach: true,
  netFollows: true,
};

/** The whole analysis of one Page. */
export async function PageAnalysisView({
  workspaceId,
  targetId,
  from,
  to,
  days,
  timeZone,
}: {
  workspaceId: string;
  targetId: string;
  from: Date;
  to: Date;
  days: number;
  timeZone: string;
}) {
  const t = await getTranslations('pageAnalysis');
  const locale = await getLocale();
  const analysis = await analysePage({ workspaceId, targetId, from, to, timeZone });

  const longDays = weekdayNames(locale, 'long');
  const shortDays = weekdayNames(locale, 'short');
  const empty = analysis.sample.current === 0 && analysis.sample.timing === 0 && analysis.lastSyncedAt === null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{t('heading', { page: analysis.page.name })}</h2>
          <p className="mt-0.5 text-sm text-slate-600">{t('period', { days })}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {analysis.lastSyncedAt
              ? t('lastRefreshed', { when: formatInZone(analysis.lastSyncedAt, timeZone, 'd MMM yyyy, HH:mm') })
              : t('neverRefreshed')}
          </p>
        </div>
        <AnalyseButton targetId={targetId} days={days} />
      </div>

      {empty ? (
        <div className="card p-8 text-center text-sm text-slate-600">{t('empty')}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <HealthCard health={analysis.health} />
            <div className="lg:col-span-2">
              <FindingsList findings={analysis.findings} weekdays={longDays} />
            </div>
          </div>

          <section>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
              {analysis.kpis.map((kpi) => (
                <StatTile
                  key={kpi.key}
                  label={t(`kpi.${kpi.key}`)}
                  value={kpi.current === null ? null : kpi.key === 'medianRate' ? `${kpi.current}%` : kpi.current}
                  delta={kpi.change}
                  deltaLabel={t('vsPrevious')}
                  upIsGood={KPI_UP_IS_GOOD[kpi.key]}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">{t('kpiHint')}</p>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CadenceChart
              target={TARGET_POSTS_PER_WEEK}
              perWeek={analysis.cadence.perWeek}
              weeks={analysis.cadence.weeks.map((week) => ({
                label: formatInZone(new Date(`${week.week}T12:00:00Z`), 'UTC', 'd MMM'),
                posts: week.posts,
              }))}
            />

            <ChartFrame
              title={t('formats.title')}
              description={t('formats.hint')}
              table={
                analysis.formats.length > 0
                  ? {
                      head: [t('formats.format'), t('formats.posts'), t('formats.avg'), t('formats.rate'), t('formats.reach')],
                      rows: analysis.formats.map((row) => [
                        t(`format.${row.format}`),
                        row.posts,
                        row.avgInteractions,
                        row.medianRate !== null ? `${row.medianRate}%` : '—',
                        row.avgReach ?? '—',
                      ]),
                    }
                  : undefined
              }
            >
              {analysis.formats.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">{t('formats.none')}</p>
              ) : (
                <ul className="space-y-3">
                  {analysis.formats.map((row) => {
                    const largest = analysis.formats[0]!.avgInteractions || 1;
                    return (
                      <li key={row.format}>
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="font-medium text-slate-700">
                            {t(`format.${row.format}`)}
                            <span className="ml-1.5 font-normal text-slate-500">
                              {t('cadence.posts', { count: row.posts })} · {row.share}%
                            </span>
                          </span>
                          <span className="nums font-semibold text-slate-900">
                            {compact(row.avgInteractions)}
                            {row.lift !== null && (
                              <span className="ml-1.5 font-normal text-slate-500">
                                {row.lift}× {t('formats.lift')}
                              </span>
                            )}
                          </span>
                        </div>
                        <span className="mt-1 block h-2.5 w-full overflow-hidden rounded-sm" style={{ background: VIZ.grid }}>
                          <span
                            className="block h-full"
                            style={{
                              width: `${Math.max(1.5, (row.avgInteractions / largest) * 100)}%`,
                              background: seriesColor(0),
                              borderTopRightRadius: 4,
                              borderBottomRightRadius: 4,
                            }}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ChartFrame>
          </div>

          <div className="space-y-2">
            <TimeHeatmap
              cells={analysis.times.cells}
              best={analysis.times.best}
              weekdays={shortDays}
              blockHours={BLOCK_HOURS}
              minPosts={MIN_POSTS_PER_SLOT}
              timeZone={timeZone}
            />
            {/* Where the finding is acted on: the queue suggests these times. */}
            {analysis.times.best.length > 0 && (
              <Link href="/queue" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
                <Icon name="clock" size={15} />
                {t('times.toQueue')}
              </Link>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <PostTable title={t('top.title')} hint={t('top.hint')} posts={analysis.top} timeZone={timeZone} />
            <PostTable title={t('bottom.title')} hint={t('bottom.hint')} posts={analysis.bottom} timeZone={timeZone} />
          </div>

          <p className="text-xs text-slate-500">
            {t('sample', { current: analysis.sample.current, timing: analysis.sample.timing })}
          </p>
        </>
      )}
    </div>
  );
}

/** The comparison's sortable columns, each with the figure it sorts by. */
const COMPARE_SORTS = {
  health: (row: PageComparisonRow) => row.health.score,
  followers: (row: PageComparisonRow) => row.followers,
  perWeek: (row: PageComparisonRow) => row.perWeek,
  avg: (row: PageComparisonRow) => row.avgInteractions,
  rate: (row: PageComparisonRow) => row.medianRate,
  reach: (row: PageComparisonRow) => row.reach,
  net: (row: PageComparisonRow) => row.netFollows,
} as const;

type CompareSort = keyof typeof COMPARE_SORTS;

/**
 * Every Page in the workspace, one row each, on the same window.
 *
 * Sortable by any figure through the URL rather than client state, so the
 * table stays a server render and a sorted view can be shared. Pages with no
 * figure for the column go last whichever way it runs: "no data" is neither
 * the best nor the worst.
 */
export async function ComparePagesView({
  workspaceId,
  from,
  to,
  days,
  timeZone,
  sort,
  order,
  targetId,
}: {
  workspaceId: string;
  from: Date;
  to: Date;
  days: number;
  timeZone: string;
  sort?: string;
  order?: string;
  /** The Page picked elsewhere on the screen, kept so sorting here does not reset it. */
  targetId?: string;
}) {
  const t = await getTranslations('pageAnalysis');
  const locale = appLocale();
  const unsorted = await comparePages({ workspaceId, from, to, timeZone });

  // Own keys only: `in` would also accept `__proto__` and `toString`.
  const sortKey = sort && Object.hasOwn(COMPARE_SORTS, sort) ? (sort as CompareSort) : null;
  const ascending = order === 'asc';
  const rows = sortKey
    ? [...unsorted].sort((a, b) => {
        const left = COMPARE_SORTS[sortKey](a);
        const right = COMPARE_SORTS[sortKey](b);
        if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
        return ascending ? left - right : right - left;
      })
    : unsorted;

  /** A header that sorts by its column: descending first, then flips. */
  const header = (key: CompareSort, label: string, align: 'left' | 'right' = 'right') => {
    const active = sortKey === key;
    const nextOrder = active && !ascending ? 'asc' : 'desc';
    return (
      <th
        scope="col"
        className={`px-3 py-2 ${align === 'right' ? 'text-right' : ''}`}
        aria-sort={active ? (ascending ? 'ascending' : 'descending') : undefined}
      >
        <Link
          href={`/analytics?view=compare${targetId ? `&target=${targetId}` : ''}&days=${days}&sort=${key}&order=${nextOrder}`}
          className={`hover:text-slate-800 ${active ? 'text-brand-700' : ''}`}
          scroll={false}
        >
          {label}
          {active && <span aria-hidden>{ascending ? ' ↑' : ' ↓'}</span>}
        </Link>
      </th>
    );
  };

  if (rows.length === 0) return <div className="card p-8 text-center text-sm text-slate-600">{t('compare.none')}</div>;

  const signed = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString(locale)}`);

  return (
    <section className="card overflow-hidden">
      <div className="px-4 pt-4 sm:px-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('compare.title')}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t('compare.hint', { days })}</p>
      </div>
      <div className="scroll-x">
        <table className="mt-3 w-full min-w-[760px] text-sm">
          <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">{t('compare.page')}</th>
              {header('health', t('compare.health'), 'left')}
              {header('followers', t('compare.followers'))}
              {header('perWeek', t('compare.perWeek'))}
              {header('avg', t('compare.avg'))}
              {header('rate', t('compare.rate'))}
              {header('reach', t('compare.reach'))}
              {header('net', t('compare.net'))}
              {/* `relative`, so the hidden label is positioned inside the scrolling
                  table rather than against the page, where it pushed the whole
                  screen sideways on a phone. */}
              <th scope="col" className="relative px-4 py-2"><span className="sr-only">{t('compare.open')}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const band = row.health.band ? BAND_STYLE[row.health.band] : null;
              return (
                <tr key={row.targetId}>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
                  <td className="px-3 py-3">
                    {row.health.score === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="nums font-semibold text-slate-900">{row.health.score}</span>
                        {band && row.health.band && (
                          <span className="flex items-center gap-0.5 text-xs" style={{ color: band.color }}>
                            <Icon name={band.icon} size={14} />
                            {t(`health.band.${row.health.band}`)}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="nums px-3 py-3 text-right text-slate-700">{row.followers?.toLocaleString(locale) ?? '—'}</td>
                  <td className="nums px-3 py-3 text-right text-slate-700">{row.perWeek}</td>
                  <td className="nums px-3 py-3 text-right text-slate-700">
                    {row.avgInteractions?.toLocaleString(locale) ?? '—'}
                    {row.avgInteractionsChange !== null && (
                      <span
                        className="ml-1 text-xs"
                        style={{ color: row.avgInteractionsChange >= 0 ? VIZ.goodText : VIZ.critical }}
                      >
                        {row.avgInteractionsChange >= 0 ? '↑' : '↓'}
                        {Math.abs(row.avgInteractionsChange)}%
                      </span>
                    )}
                  </td>
                  <td className="nums px-3 py-3 text-right text-slate-700">{row.medianRate !== null ? `${row.medianRate}%` : '—'}</td>
                  <td className="nums px-3 py-3 text-right text-slate-700">{row.reach !== null ? compact(row.reach, locale) : '—'}</td>
                  <td className="nums px-3 py-3 text-right text-slate-700">{signed(row.netFollows)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/analytics?view=analysis&target=${row.targetId}&days=${days}`}
                      className="btn-ghost text-xs"
                    >
                      {t('compare.open')}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
