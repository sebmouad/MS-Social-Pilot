import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { CadenceChart } from './CadenceChart';
import { TimeHeatmap } from './TimeHeatmap';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { StatTile } from '@/components/charts/StatTile';
import { CompareChart } from './CompareChart';
import { KpiExplorer } from './KpiExplorer';
import type { PostingTips } from '@/lib/page-analysis';
import { ExternalLink } from '@/components/ExternalLink';
import { FeedPost } from '@/components/FeedPost';
import { Icon, type IconName } from '@/components/Icon';
import { analysePage, comparePages, type PageComparisonRow } from '@/lib/page-analysis-data';
import { listChartNotes } from '@/lib/chart-notes';
import type { CompareMode } from '@/lib/date-range';
import { paletteOf, type PaletteKey } from '@/lib/palette';
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

/**
 * The best and weakest posts, each drawn as the post itself rather than a
 * table row: what a post looked like is half of why it did well.
 */
async function PostTable({
  title,
  hint,
  posts,
  page,
  timeZone,
}: {
  title: string;
  hint: string;
  posts: AnalysedPost[];
  page: { name: string; pictureUrl: string | null };
  timeZone: string;
}) {
  const t = await getTranslations('pageAnalysis');
  const tCommon = await getTranslations('common');
  if (posts.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="px-1">
        <h3 className="text-[17px] font-bold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-sm text-slate-600">{hint}</p>
      </div>
      <ol className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post, index) => (
          <li key={post.id}>
            <FeedPost
              compact
              clamp
              author={page}
              meta={`${formatInZone(post.publishedAt, timeZone, 'd MMM, HH:mm')} · ${t(`format.${post.format}`)} · ${
                post.source === 'app' ? t('post.fromApp') : t('post.fromPage')
              }`}
              badge={
                <span className="nums rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                  #{index + 1}
                </span>
              }
              message={post.message}
              emptyText={t('post.noText')}
              media={post.media ?? []}
              linkPreview={post.linkPreview}
              mediaHref={post.url}
              seeMore={tCommon('seeMore')}
              stats={{
                reactions: post.reactions,
                others: [
                  t('post.commentCount', { count: post.comments }),
                  t('post.shareCount', { count: post.shares }),
                ],
              }}
              footer={
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1 text-[13px] text-slate-600">
                  <span>
                    {post.reach !== null && t('post.reachCount', { count: post.reach })}
                    {post.rate !== null && ` · ${t('post.rate')} ${post.rate}%`}
                  </span>
                  {post.url && (
                    <ExternalLink href={post.url} className="font-semibold text-brand-600 hover:underline">
                      {t('post.open')}
                    </ExternalLink>
                  )}
                </div>
              }
            />
          </li>
        ))}
      </ol>
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
  compare = 'previous',
  notesAccess,
}: {
  workspaceId: string;
  targetId: string;
  from: Date;
  to: Date;
  days: number;
  timeZone: string;
  compare?: CompareMode;
  /** Who may add chart notes (H13); absent shows them read-only, as in reports. */
  notesAccess?: { canEdit: boolean; canNoteAllPages: boolean };
}) {
  const t = await getTranslations('pageAnalysis');
  const locale = await getLocale();
  const analysis = await analysePage({ workspaceId, targetId, from, to, timeZone, compare });
  const dayList = analysis.daily.days;
  const chartNotes =
    dayList.length > 0
      ? await listChartNotes({ workspaceId, targetId, firstDay: dayList[0]!, lastDay: dayList[dayList.length - 1]! })
      : [];

  const longDays = weekdayNames(locale, 'long');
  const shortDays = weekdayNames(locale, 'short');
  const empty = analysis.sample.current === 0 && analysis.sample.timing === 0 && analysis.lastSyncedAt === null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{t('heading', { page: analysis.page.name })}</h2>
          <p className="mt-0.5 text-sm text-slate-600">{t(compare === 'year' ? 'periodYear' : 'period', { days })}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {analysis.lastSyncedAt
              ? t('lastRefreshed', { when: formatInZone(analysis.lastSyncedAt, timeZone, 'd MMM yyyy, HH:mm') })
              : t('neverRefreshed')}
          </p>
        </div>
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

          <PostingTipsTiles tips={analysis.tips} weekdays={longDays} />

          <section>
            <KpiExplorer
              vsLabel={t(compare === 'year' ? 'vsYear' : 'vsPrevious')}
              days={analysis.daily.days}
              notes={chartNotes}
              notesControl={{ targetId, canEdit: notesAccess?.canEdit ?? false, canNoteAllPages: notesAccess?.canNoteAllPages ?? false }}
              cards={analysis.kpis.map((kpi) => ({
                key: kpi.key,
                label: t(`kpi.${kpi.key}`),
                value: kpi.current === null ? null : kpi.key === 'medianRate' ? `${kpi.current}%` : kpi.current,
                change: kpi.change,
                upIsGood: KPI_UP_IS_GOOD[kpi.key],
                series: kpi.key === 'netFollows' ? null : analysis.daily[kpi.key],
                note: kpi.key === 'reach' ? t('reachDailyNote') : undefined,
                definition: t(`kpiDef.${kpi.key}`),
              }))}
            />
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
                            <span className="ms-1.5 font-normal text-slate-500">
                              {t('cadence.posts', { count: row.posts })} · {row.share}%
                            </span>
                          </span>
                          <span className="nums font-semibold text-slate-900">
                            {compact(row.avgInteractions)}
                            {row.lift !== null && (
                              <span className="ms-1.5 font-normal text-slate-500">
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <LiftList
              title={t('hashtags.title')}
              description={t('hashtags.hint')}
              empty={t('hashtags.none')}
              head={[t('hashtags.tag'), t('formats.posts'), t('formats.avg'), t('formats.reach')]}
              rows={analysis.hashtags.slice(0, 8).map((row) => ({
                key: row.tag,
                label: row.tag,
                detail: t('cadence.posts', { count: row.posts }),
                value: row.avgInteractions,
                lift: row.lift,
                table: [row.tag, row.posts, Math.round(row.avgInteractions), row.avgReach !== null ? Math.round(row.avgReach) : '—'],
              }))}
              liftLabel={t('formats.lift')}
            />
            <LiftList
              title={t('captions.title')}
              description={t('captions.hint')}
              empty={t('captions.none')}
              head={[t('captions.kind'), t('formats.posts'), t('formats.avg')]}
              rows={analysis.captions.map((row) => ({
                key: row.trait,
                label: t(`captions.trait.${row.trait}`),
                detail: `${t('cadence.posts', { count: row.posts })} · ${row.share}%`,
                value: row.avgInteractions,
                lift: row.lift,
                table: [t(`captions.trait.${row.trait}`), row.posts, Math.round(row.avgInteractions)],
              }))}
              liftLabel={t('formats.lift')}
            />
          </div>

          <div className="space-y-6">
            <PostTable title={t('top.title')} hint={t('top.hint')} posts={analysis.top} page={analysis.page} timeZone={timeZone} />
            <PostTable title={t('bottom.title')} hint={t('bottom.hint')} posts={analysis.bottom} page={analysis.page} timeZone={timeZone} />
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
  rangeQuery,
  compare = 'previous',
  targetIds,
  groups = [],
  groupId,
}: {
  workspaceId: string;
  from: Date;
  to: Date;
  days: number;
  timeZone: string;
  compare?: CompareMode;
  /** The Pages this member may see; every Page when absent. */
  targetIds?: string[];
  /** Groups to narrow the table to, and the one chosen. */
  groups?: Array<{ id: string; name: string; color: PaletteKey; targetIds: string[] }>;
  groupId?: string;
  sort?: string;
  order?: string;
  /** The Page picked elsewhere on the screen, kept so sorting here does not reset it. */
  targetId?: string;
  /** `range=…` or `from=…&to=…`, so a sort or a Page link keeps the exact period. */
  rangeQuery?: string;
}) {
  const t = await getTranslations('pageAnalysis');
  const tTotal = await getTranslations('totalView');
  const locale = appLocale();
  const group = groups.find((entry) => entry.id === groupId) ?? null;
  const allowed = group
    ? group.targetIds.filter((id) => !targetIds || targetIds.includes(id))
    : targetIds;
  const unsorted = await comparePages({ workspaceId, from, to, timeZone, compare, targetIds: allowed });
  const groupQuery = group ? `&group=${group.id}` : '';

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
        className={`px-3 py-2 ${align === 'right' ? 'text-end' : ''}`}
        aria-sort={active ? (ascending ? 'ascending' : 'descending') : undefined}
      >
        <Link
          href={`/analytics?view=compare${targetId ? `&target=${targetId}` : ''}&${rangeQuery ?? `days=${days}`}${groupQuery}&sort=${key}&order=${nextOrder}`}
          className={`hover:text-slate-800 ${active ? 'text-brand-700' : ''}`}
          scroll={false}
        >
          {label}
          {active && <span aria-hidden>{ascending ? ' ↑' : ' ↓'}</span>}
        </Link>
      </th>
    );
  };

  const groupChips =
    groups.length > 0 ? (
      <nav className="flex flex-wrap items-center gap-2" aria-label={t('compare.groups')}>
        {[{ id: '', name: t('compare.allPages'), color: null as PaletteKey | null }, ...groups].map((entry) => {
          const on = (group?.id ?? '') === entry.id;
          return (
            <Link
              key={entry.id || 'all'}
              href={`/analytics?view=compare${targetId ? `&target=${targetId}` : ''}&${rangeQuery ?? `days=${days}`}${entry.id ? `&group=${entry.id}` : ''}`}
              aria-current={on ? 'true' : undefined}
              scroll={false}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold ${
                on ? 'bg-brand-50 text-brand-600' : 'bg-white text-slate-700 shadow-surface hover:bg-slate-50'
              }`}
            >
              {entry.color && <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${paletteOf(entry.color).dot}`} />}
              {entry.name}
            </Link>
          );
        })}
      </nav>
    ) : null;

  if (rows.length === 0)
    return (
      <div className="space-y-4">
        {groupChips}
        <div className="card p-8 text-center text-sm text-slate-600">{t('compare.none')}</div>
      </div>
    );

  const sum = (pick: (row: PageComparisonRow) => number | null) => {
    const known = rows.map(pick).filter((value): value is number => value !== null);
    return known.length ? known.reduce((total, value) => total + value, 0) : null;
  };
  const totals = {
    followers: sum((row) => row.followers),
    perWeek: Math.round((sum((row) => row.perWeek) ?? 0) * 10) / 10,
    interactions: sum((row) => row.interactions),
    posts: sum((row) => row.posts),
    reach: sum((row) => row.reach),
    net: sum((row) => row.netFollows),
  };

  const signed = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString(locale)}`);

  return (
    <div className="space-y-4">
    {groupChips}
    {rows.length > 1 && (
      <CompareChart
        days={rows[0]!.daily.days}
        profiles={rows.map((row) => ({
          id: row.targetId,
          name: row.name,
          daily: { interactions: row.daily.interactions, posts: row.daily.posts, reach: row.daily.reach },
        }))}
      />
    )}
    <section className="card overflow-hidden">
      <div className="px-4 pt-4 sm:px-5">
        <h2 className="text-sm font-semibold text-slate-900">{group ? t('compare.groupTitle', { group: group.name }) : t('compare.title')}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t('compare.hint', { days })}</p>
      </div>
      <div className="scroll-x">
        <table className="mt-3 w-full min-w-[760px] text-sm">
          <thead className="border-y border-slate-200 bg-slate-50 text-start text-[13px] font-semibold text-slate-600">
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
                  <td className="nums px-3 py-3 text-end text-slate-700">{row.followers?.toLocaleString(locale) ?? '—'}</td>
                  <td className="nums px-3 py-3 text-end text-slate-700">{row.perWeek}</td>
                  <td className="nums px-3 py-3 text-end text-slate-700">
                    {row.avgInteractions?.toLocaleString(locale) ?? '—'}
                    {row.avgInteractionsChange !== null && (
                      <span
                        className="ms-1 text-xs"
                        style={{ color: row.avgInteractionsChange >= 0 ? VIZ.goodText : VIZ.critical }}
                      >
                        {row.avgInteractionsChange >= 0 ? '↑' : '↓'}
                        {Math.abs(row.avgInteractionsChange)}%
                      </span>
                    )}
                  </td>
                  <td className="nums px-3 py-3 text-end text-slate-700">{row.medianRate !== null ? `${row.medianRate}%` : '—'}</td>
                  <td className="nums px-3 py-3 text-end text-slate-700">{row.reach !== null ? compact(row.reach, locale) : '—'}</td>
                  <td className="nums px-3 py-3 text-end text-slate-700">{signed(row.netFollows)}</td>
                  <td className="px-4 py-3 text-end">
                    <Link
                      href={`/analytics?view=analysis&target=${row.targetId}&${rangeQuery ?? `days=${days}`}`}
                      className="btn-ghost text-xs"
                    >
                      {t('compare.open')}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 1 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
              <tr>
                <th scope="row" className="px-4 py-3 text-start">
                  {t('compare.total', { count: rows.length })}
                </th>
                <td className="px-3 py-3" />
                <td className="nums px-3 py-3 text-end">{totals.followers?.toLocaleString(locale) ?? '—'}</td>
                <td className="nums px-3 py-3 text-end">{totals.perWeek}</td>
                <td className="nums px-3 py-3 text-end" title={t('compare.totalAvgHint')}>
                  {totals.posts && totals.interactions !== null
                    ? Math.round(totals.interactions / totals.posts).toLocaleString(locale)
                    : '—'}
                </td>
                <td className="px-3 py-3" />
                {/* Reach counts people, who may follow several of these Pages: the sum is a ceiling. */}
                <td
                  className="nums px-3 py-3 text-end"
                  title={tTotal('reachHelp', { count: rows.filter((row) => row.reach !== null).length })}
                >
                  {totals.reach !== null ? tTotal('upTo', { value: compact(totals.reach, locale) }) : '—'}
                </td>
                <td className="nums px-3 py-3 text-end">{signed(totals.net)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
    </div>
  );
}

/**
 * A ranked list of groups against the Page's typical post: hashtags, kinds of
 * caption. Bars show average interactions; the lift beside them says it in
 * words, with par drawn as the colour change from blue to grey.
 */
function LiftList({
  title,
  description,
  empty,
  head,
  rows,
  liftLabel,
}: {
  title: string;
  description: string;
  empty: string;
  head: string[];
  rows: Array<{
    key: string;
    label: string;
    detail: string;
    value: number;
    lift: number | null;
    table: Array<string | number>;
  }>;
  liftLabel: string;
}) {
  const largest = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ChartFrame
      title={title}
      description={description}
      table={rows.length > 0 ? { head, rows: rows.map((row) => row.table) } : undefined}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-semibold text-slate-800">
                  {row.label}
                  <span className="ms-1.5 font-normal text-slate-500">{row.detail}</span>
                </span>
                <span className="nums shrink-0 font-semibold text-slate-900">
                  {compact(Math.round(row.value))}
                  {row.lift !== null && (
                    <span className={`ms-1.5 font-normal ${row.lift >= 1 ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {Math.round(row.lift * 10) / 10}× {liftLabel}
                    </span>
                  )}
                </span>
              </div>
              <span className="mt-1 block h-2.5 w-full overflow-hidden rounded-sm" style={{ background: VIZ.grid }}>
                <span
                  className="block h-full"
                  style={{
                    width: `${Math.max(1.5, (row.value / largest) * 100)}%`,
                    background: row.lift !== null && row.lift < 1 ? VIZ.muted : seriesColor(0),
                    borderTopRightRadius: 4,
                    borderBottomRightRadius: 4,
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}

/**
 * The two questions people open analytics to answer, answered in words: which
 * day to post on, and how many posts a day. Both from this Page's own last
 * ninety days, and both say so when there is not enough behind them yet.
 */
async function PostingTipsTiles({ tips, weekdays }: { tips: PostingTips; weekdays: string[] }) {
  const t = await getTranslations('pageAnalysis');
  const tiles = [
    {
      icon: 'calendar' as const,
      title: t('tips.bestDayTitle'),
      value: tips.bestDay ? weekdays[tips.bestDay.weekday] ?? '—' : t('tips.notYet'),
      hint: tips.bestDay
        ? t('tips.bestDayHint', { lift: tips.bestDay.lift, posts: tips.bestDay.posts })
        : t('tips.bestDayEmpty'),
    },
    {
      icon: 'trendUp' as const,
      title: t('tips.frequencyTitle'),
      value: tips.bestPerDay ? t('tips.perDay', { count: tips.bestPerDay.count }) : t('tips.notYet'),
      hint: tips.bestPerDay
        ? t('tips.frequencyHint', { count: tips.bestPerDay.count, days: tips.bestPerDay.days })
        : t('tips.frequencyEmpty'),
    },
  ];
  return (
    <section aria-label={t('tips.title')} className="grid gap-3 sm:grid-cols-2">
      {tiles.map((tile) => (
        <div key={tile.title} className="card relative flex items-start gap-3 overflow-hidden p-4">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Icon name={tile.icon} size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-600">{tile.title}</p>
            <p className="text-xl font-bold text-slate-900 first-letter:uppercase">{tile.value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{tile.hint}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
