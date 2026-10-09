import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { requirePage } from '@/lib/auth';
import { canManageOthersPosts, postIsEditable } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { formatInZone, monthGrid } from '@/lib/time';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('calendar.title');
}

/** Dot colours, matching the badge colours StatusBadge gives each status. */
const STATUS_DOT: Record<string, string> = {
  pending_approval: 'bg-violet-500',
  rejected: 'bg-rose-500',
  scheduled: 'bg-blue-500',
  publishing: 'bg-amber-500',
  published: 'bg-emerald-500',
  partially_failed: 'bg-orange-500',
  failed: 'bg-red-500',
  draft: 'bg-slate-400',
  cancelled: 'bg-slate-300',
};

/** The same colours as the edge of a post on the grid, as Facebook's planner marks them. */
const STATUS_EDGE: Record<string, string> = {
  pending_approval: 'border-l-violet-500',
  rejected: 'border-l-rose-500',
  scheduled: 'border-l-blue-500',
  publishing: 'border-l-amber-500',
  published: 'border-l-emerald-500',
  partially_failed: 'border-l-orange-500',
  failed: 'border-l-red-500',
  draft: 'border-l-slate-400',
  cancelled: 'border-l-slate-300',
};

/** Every status the grid can show; cancelled posts are left off it. */
const LEGEND = [
  'pending_approval',
  'rejected',
  'scheduled',
  'publishing',
  'published',
  'partially_failed',
  'failed',
  'draft',
];

/** Undated drafts listed under the grid; the post list has the rest. */
const DRAFT_LIMIT = 10;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const locale = await getLocale();
  const t = await getTranslations('calendar');
  const tDash = await getTranslations('dashboard');
  const tPosts = await getTranslations('posts');
  const params = await searchParams;
  const timezone = auth.workspace.timezone;

  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const today = new Date();
  // `month` is `YYYY-MM` in workspace-local terms.
  const [yearString, monthString] = (monthParam ?? formatInZone(today, timezone, 'yyyy-MM')).split('-');
  const year = Number.parseInt(yearString ?? '', 10);
  const monthIndex = Number.parseInt(monthString ?? '', 10) - 1;

  const safeYear = Number.isFinite(year) ? year : today.getUTCFullYear();
  const safeMonth = Number.isFinite(monthIndex) && monthIndex >= 0 && monthIndex <= 11 ? monthIndex : today.getUTCMonth();

  const days = monthGrid(safeYear, safeMonth, timezone);
  const gridStart = days[0]!;
  const gridEnd = new Date(days[days.length - 1]!.getTime() + 24 * 60 * 60 * 1000);

  const [posts, drafts] = await Promise.all([
    prisma.post.findMany({
      where: {
        workspaceId: auth.workspace.id,
        scheduledAt: { gte: gridStart, lt: gridEnd },
        status: { not: 'cancelled' },
      },
      include: { targets: { include: { target: { select: { name: true, pictureUrl: true } } } } },
      orderBy: { scheduledAt: 'asc' },
    }),
    // A draft saved without a time has no square to sit on, so a calendar of
    // only dated posts hid exactly the work that still needs a date.
    prisma.post.findMany({
      where: { workspaceId: auth.workspace.id, status: 'draft', scheduledAt: null },
      include: { targets: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
      take: DRAFT_LIMIT,
    }),
  ]);

  // Bucket by the local calendar day so a post at 23:00 UTC+2 lands on the
  // right square rather than the previous day.
  const byDay = new Map<string, typeof posts>();
  for (const post of posts) {
    if (!post.scheduledAt) continue;
    const key = formatInZone(post.scheduledAt, timezone, 'yyyy-MM-dd');
    const bucket = byDay.get(key) ?? [];
    bucket.push(post);
    byDay.set(key, bucket);
  }

  const previous = new Date(Date.UTC(safeYear, safeMonth - 1, 1));
  const next = new Date(Date.UTC(safeYear, safeMonth + 1, 1));
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(safeYear, safeMonth, 1)));

  // 2024-01-07 was a Sunday, so this indexes weekdays 0..6 in the active locale.
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone });
  const weekdayName = (day: number) =>
    weekdayFormatter.format(new Date(Date.UTC(2024, 0, 7 + day)));
  const todayKey = formatInZone(today, timezone, 'yyyy-MM-dd');
  const manageOthers = canManageOthersPosts(auth.role);

  // A post this person can still change opens in the composer; anything else
  // (published, going out, or someone else's) opens the list, which says why.
  const postHref = (post: {
    id: string;
    authorId: string;
    status: string;
    targets: Array<{ status: string }>;
  }) =>
    postIsEditable(post) && (manageOthers || post.authorId === auth.user.id)
      ? `/compose?post=${post.id}`
      : '/posts';
  // "New post on this day" starts at nine in the morning; today it keeps the
  // composer's own default of an hour from now.
  const newPostHref = (key: string) => (key === todayKey ? '/compose' : `/compose?at=${key}T09:00`);
  const monthHref = (date: Date) =>
    `/calendar?month=${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

  // The month at a glance, above the grid: what is planned and what went out.
  const inMonthPosts = posts.filter(
    (post) => post.scheduledAt && Number(formatInZone(post.scheduledAt, timezone, 'M')) - 1 === safeMonth,
  );
  const summary = LEGEND.map((status) => ({
    status,
    count: inMonthPosts.filter((post) => post.status === status).length,
  })).filter((entry) => entry.count > 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold capitalize text-slate-900">{monthLabel}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {t('title')} · {t('timesShownIn', { timezone })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/calendar" className="btn-secondary">
            {t('today')}
          </Link>
          <Link
            href={monthHref(previous)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-900 hover:bg-slate-300"
            aria-label={t('previousMonth')}
            title={t('previousMonth')}
          >
            <Icon name="chevronLeft" size={18} />
          </Link>
          <Link
            href={monthHref(next)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-900 hover:bg-slate-300"
            aria-label={t('nextMonth')}
            title={t('nextMonth')}
          >
            <Icon name="chevronRight" size={18} />
          </Link>
          <Link href="/compose" className="btn-primary">
            {tDash('newPost')}
          </Link>
        </div>
      </header>

      {summary.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('monthSummary')}>
          {summary.map((entry) => (
            <li
              key={entry.status}
              className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm shadow-surface"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[entry.status]}`} />
              <span className="nums font-semibold text-slate-900">{entry.count}</span>
              <StatusBadge status={entry.status} />
            </li>
          ))}
        </ul>
      )}

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-white">
          {/* Monday-first, matching monthGrid. */}
          {[1, 2, 3, 4, 5, 6, 0].map((day) => (
            <div key={day} className="px-2 py-2.5 text-center text-[13px] font-semibold text-slate-600">
              {weekdayName(day)}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = formatInZone(day, timezone, 'yyyy-MM-dd');
            const dayPosts = byDay.get(key) ?? [];
            const inMonth = Number.parseInt(formatInZone(day, timezone, 'M'), 10) - 1 === safeMonth;

            return (
              <div
                key={key}
                className={`min-h-[8rem] border-b border-r border-slate-200 p-2 ${
                  key === todayKey ? 'bg-brand-50/60' : inMonth ? (key < todayKey ? 'bg-slate-50' : 'bg-white') : 'bg-slate-100/70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[13px] font-semibold ${
                      key === todayKey
                        ? 'flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white'
                        : inMonth
                          ? 'text-slate-900'
                          : 'text-slate-400'
                    }`}
                  >
                    {formatInZone(day, timezone, 'd')}
                  </span>
                  <span className="flex items-center gap-1">
                    {dayPosts.length > 2 && (
                      <span className="text-[10px] text-slate-400">{dayPosts.length}</span>
                    )}
                    {key >= todayKey && (
                      <Link
                        href={newPostHref(key)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-base leading-none text-slate-500 hover:bg-brand-50 hover:text-brand-600 focus-visible:bg-brand-50"
                        aria-label={t('newPostOn', { date: dayLabel.format(day) })}
                        title={t('newPostOn', { date: dayLabel.format(day) })}
                      >
                        +
                      </Link>
                    )}
                  </span>
                </div>

                <ul className="mt-1 space-y-1">
                  {dayPosts.slice(0, 3).map((post) => (
                    <li key={post.id}>
                      <Link
                        href={postHref(post)}
                        className={`block rounded-md border-l-[3px] bg-white px-2 py-1.5 shadow-surface transition-shadow hover:shadow-md ${
                          STATUS_EDGE[post.status] ?? 'border-l-slate-400'
                        }`}
                        title={post.message || post.link || ''}
                      >
                        <span className="flex items-center gap-1.5">
                          {post.targets[0]?.target.pictureUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={post.targets[0].target.pictureUrl}
                              alt=""
                              className="h-4 w-4 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <span
                              aria-hidden
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[9px] font-bold text-brand-600"
                            >
                              {(post.targets[0]?.target.name ?? '?').charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="text-[11px] font-semibold text-slate-900">
                            {post.scheduledAt ? formatInZone(post.scheduledAt, timezone, 'HH:mm') : ''}
                          </span>
                          <span className="sr-only">
                            <StatusBadge status={post.status} />
                          </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block [overflow-wrap:anywhere] text-xs leading-tight text-slate-700">
                          {post.message || post.link || tPosts('mediaOnly')}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {dayPosts.length > 3 && (
                    <li className="px-1.5 text-[10px] text-slate-400">
                      {t('more', { count: dayPosts.length - 3 })}
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        {LEGEND.map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
            <StatusBadge status={status} />
          </span>
        ))}
      </div>

      {drafts.length > 0 && (
        <section className="card p-4 sm:p-5" aria-labelledby="unscheduled-drafts">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="unscheduled-drafts" className="text-sm font-semibold text-slate-900">
              {t('unscheduledDrafts')}
            </h2>
            <Link href="/posts?status=draft" className="text-xs font-medium text-brand-600 hover:underline">
              {t('allDrafts')}
            </Link>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t('unscheduledDraftsHint', { count: drafts.length })}</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link
                  href={postHref(draft)}
                  className="flex flex-col gap-0.5 py-2 hover:bg-slate-50 sm:flex-row sm:items-baseline sm:gap-3"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                    {draft.message || draft.link || tPosts('mediaOnly')}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {t('draftCreated', { date: formatInZone(draft.createdAt, timezone, 'd MMM yyyy', locale) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
