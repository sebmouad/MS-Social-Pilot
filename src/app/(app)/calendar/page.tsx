import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { requirePage } from '@/lib/auth';
import { canManageOthersPosts, postIsEditable } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { formatInZone, monthGrid } from '@/lib/time';
import { StatusBadge } from '@/components/StatusBadge';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('calendar.title');
}


const STATUS_DOT: Record<string, string> = {
  scheduled: 'bg-blue-500',
  publishing: 'bg-amber-500',
  published: 'bg-emerald-500',
  partially_failed: 'bg-orange-500',
  failed: 'bg-red-500',
  draft: 'bg-slate-400',
  cancelled: 'bg-slate-300',
};

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

  const posts = await prisma.post.findMany({
    where: {
      workspaceId: auth.workspace.id,
      scheduledAt: { gte: gridStart, lt: gridEnd },
      status: { not: 'cancelled' },
    },
    include: { targets: { include: { target: { select: { name: true } } } } },
    orderBy: { scheduledAt: 'asc' },
  });

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
  const postHref = (post: (typeof posts)[number]) =>
    postIsEditable(post) && (manageOthers || post.authorId === auth.user.id)
      ? `/compose?post=${post.id}`
      : '/posts';
  // "New post on this day" starts at nine in the morning; today it keeps the
  // composer's own default of an hour from now.
  const newPostHref = (key: string) => (key === todayKey ? '/compose' : `/compose?at=${key}T09:00`);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('timesShownIn', { timezone })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/calendar?month=${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`}
            className="btn-secondary"
          >
            ←
          </Link>
          <span className="min-w-[10rem] text-center text-sm font-medium text-slate-900">{monthLabel}</span>
          <Link
            href={`/calendar?month=${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`}
            className="btn-secondary"
          >
            →
          </Link>
          <Link href="/compose" className="btn-primary">
            {tDash('newPost')}
          </Link>
        </div>
      </header>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {/* Monday-first, matching monthGrid. */}
          {[1, 2, 3, 4, 5, 6, 0].map((day) => (
            <div key={day} className="px-2 py-2 text-center text-xs font-medium text-slate-500">
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
                className={`min-h-[7rem] border-b border-r border-slate-100 p-2 ${
                  inMonth ? 'bg-white' : 'bg-slate-50/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-medium ${
                      key === todayKey
                        ? 'flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white'
                        : inMonth
                          ? 'text-slate-700'
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
                        className="flex h-5 w-5 items-center justify-center rounded text-sm leading-none text-slate-400 hover:bg-brand-50 hover:text-brand-600 focus-visible:bg-brand-50"
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
                        className="block rounded border border-slate-200 bg-white px-1.5 py-1 hover:border-brand-300"
                        title={post.message || post.link || ''}
                      >
                        <span className="flex items-center gap-1">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[post.status] ?? 'bg-slate-400'}`}
                          />
                          <span className="text-[10px] font-medium text-slate-500">
                            {post.scheduledAt ? formatInZone(post.scheduledAt, timezone, 'HH:mm') : ''}
                          </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block [overflow-wrap:anywhere] text-[11px] leading-tight text-slate-700">
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
        {['scheduled', 'publishing', 'published', 'partially_failed', 'failed'].map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
            <StatusBadge status={status} />
          </span>
        ))}
      </div>
    </div>
  );
}
