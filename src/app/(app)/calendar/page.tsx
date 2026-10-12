import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { requirePage } from '@/lib/auth';
import { loadPageFilter } from '@/lib/page-filter';
import { aiAvailable } from '@/lib/ai';
import { AiPlanner } from '@/components/AiPlanner';
import { listLabels } from '@/lib/page-groups';
import { paletteOf } from '@/lib/palette';
import { ChannelsLayout } from '@/components/ChannelsLayout';
import { LabelFilter } from '@/components/LabelFilter';
import { WeekGrid } from '@/components/CalendarWeek';
import { CalendarDrag } from '@/components/CalendarDrag';
import { PageFeedPreview } from '@/components/PageFeedPreview';
import { feedLinkOf, feedMediaOf, feedMediaOfPicture } from '@/lib/feed';
import { canManageOthersPosts, canManageSettings, postIsEditable } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { formatInZone, monthGrid, weekGrid } from '@/lib/time';
import { keyDaysBetween, type KeyDay } from '@/lib/calendar-days';
import { StatusBadge } from '@/components/StatusBadge';
import { parseMedia } from '@/lib/json';
import { Icon } from '@/components/Icon';
import { CalendarFeedButton } from '@/components/CalendarFeedButton';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('calendar.title');
}

/** Dot colours, matching the badge colours StatusBadge gives each status. */
const STATUS_DOT: Record<string, string> = {
  pending_approval: 'bg-violet-500',
  rejected: 'bg-red-500',
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
  rejected: 'border-l-red-500',
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
  const tDays = await getTranslations('calendar.days');
  const tCommon = await getTranslations('common');
  const tStatus = await getTranslations('status');
  const params = await searchParams;
  const timezone = auth.workspace.timezone;

  const pick = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const view: 'month' | 'week' | 'feed' =
    pick('view') === 'week' ? 'week' : pick('view') === 'feed' ? 'feed' : 'month';
  // Drafts sit on the grid with everything else unless switched off.
  const hideDrafts = pick('drafts') === 'hide';
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const today = new Date();
  // `month` is `YYYY-MM` in workspace-local terms.
  const [yearString, monthString] = (monthParam ?? formatInZone(today, timezone, 'yyyy-MM')).split('-');
  const year = Number.parseInt(yearString ?? '', 10);
  const monthIndex = Number.parseInt(monthString ?? '', 10) - 1;

  const safeYear = Number.isFinite(year) ? year : today.getUTCFullYear();
  const safeMonth = Number.isFinite(monthIndex) && monthIndex >= 0 && monthIndex <= 11 ? monthIndex : today.getUTCMonth();

  const [filter, labels, aiSetting] = await Promise.all([
    loadPageFilter(auth, params),
    listLabels(auth.workspace.id),
    prisma.workspace.findUnique({ where: { id: auth.workspace.id }, select: { aiEnabled: true, weekStartsOn: true } }),
  ]);
  const aiOn = aiAvailable() && Boolean(aiSetting?.aiEnabled);
  const labelParam = Array.isArray(params.label) ? params.label[0] : params.label;
  const activeLabel = labels.find((label) => label.id === labelParam) ?? null;
  const narrowing = {
    ...filter.postWhere,
    ...(activeLabel ? { labels: { some: { labelId: activeLabel.id } } } : {}),
  };

  const weekParam = pick('week');
  const anchor = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : formatInZone(today, timezone, 'yyyy-MM-dd');
  const weekStartsOn = aiSetting?.weekStartsOn ?? 1;
  const days = view === 'month' ? monthGrid(safeYear, safeMonth, timezone, weekStartsOn) : weekGrid(anchor, timezone, weekStartsOn);
  const gridStart = days[0]!;
  const gridEnd = new Date(days[days.length - 1]!.getTime() + 24 * 60 * 60 * 1000);
  const keyDays = await keyDaysBetween(
    auth.workspace.id,
    filter.ids,
    formatInZone(gridStart, timezone, 'yyyy-MM-dd'),
    formatInZone(days[days.length - 1]!, timezone, 'yyyy-MM-dd'),
  );
  /** What a key day is called for this reader. */
  const keyDayName = (day: KeyDay) =>
    day.kind === 'computed'
      ? tDays(day.key)
      : day.kind === 'custom'
        ? day.title
        : `${locale.startsWith('en') ? day.name : day.localName} (${day.country})`;
  const keyDaysOn = (key: string) => (keyDays.get(key) ?? []).map((day) => ({ id: `${day.kind}:${keyDayName(day)}`, name: keyDayName(day), kind: day.kind }));

  const [posts, drafts] = await Promise.all([
    prisma.post.findMany({
      where: {
        workspaceId: auth.workspace.id,
        scheduledAt: { gte: gridStart, lt: gridEnd },
        status: hideDrafts ? { notIn: ['cancelled', 'draft'] } : { not: 'cancelled' },
        ...narrowing,
      },
      include: {
        targets: { include: { target: { select: { name: true, pictureUrl: true } } } },
        labels: { select: { labelId: true } },
        _count: { select: { notes: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    }),
    // A draft saved without a time has no square to sit on, so a calendar of
    // only dated posts hid exactly the work that still needs a date.
    prisma.post.findMany({
      where: { workspaceId: auth.workspace.id, status: 'draft', scheduledAt: null, ...narrowing },
      include: { targets: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
      take: DRAFT_LIMIT,
    }),
  ]);

  // The feed view shows one Page: the one left visible, or the first.
  const feedPageId = view === 'feed' ? (filter.visible?.length === 1 ? filter.visible[0] : filter.ids[0]) : undefined;
  const [feedPage, feedUpcoming, feedOurs, feedFound] = feedPageId
    ? await Promise.all([
        prisma.target.findUnique({
          where: { id: feedPageId },
          select: { name: true, pictureUrl: true, category: true, followersCount: true, fanCount: true },
        }),
        prisma.post.findMany({
          where: {
            workspaceId: auth.workspace.id,
            targets: { some: { targetId: feedPageId } },
            status: { in: hideDrafts ? ['scheduled', 'pending_approval', 'publishing'] : ['scheduled', 'pending_approval', 'publishing', 'draft'] },
            OR: [{ scheduledAt: { gte: today } }, { scheduledAt: null }],
            ...(activeLabel ? { labels: { some: { labelId: activeLabel.id } } } : {}),
          },
          include: { targets: { select: { status: true } } },
          orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          take: 30,
        }),
        prisma.postTarget.findMany({
          where: { targetId: feedPageId, status: 'published' },
          include: { post: { select: { message: true, media: true, link: true, linkPreview: true } } },
          orderBy: { publishedAt: 'desc' },
          take: 5,
        }),
        // Posted from Facebook itself, or before this app: the feed is the Page's, not ours.
        prisma.externalPost.findMany({
          where: { targetId: feedPageId },
          orderBy: { createdTime: 'desc' },
          take: 5,
        }),
      ])
    : [null, [], [], []];
  const sentFromHere = new Set(feedOurs.map((row) => row.remotePostId).filter(Boolean));
  const feedRecent = [
    ...feedOurs.map((row) => ({
      id: row.id,
      at: row.publishedAt,
      message: row.post.message,
      media: feedMediaOf(row.post.media),
      link: row.post.link,
      linkPreview: feedLinkOf(row.post.linkPreview),
    })),
    ...feedFound
      .filter((row) => !sentFromHere.has(row.remoteId))
      .map((row) => ({
        id: row.id,
        at: row.createdTime as Date | null,
        message: row.message ?? '',
        media: feedMediaOfPicture(row.pictureUrl, row.statusType === 'added_video'),
        link: null,
        linkPreview: null,
      })),
  ]
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(0, 5);

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
  // Only what the composer would open may be dragged to another day.
  const movable = (post: Parameters<typeof postHref>[0]) => postHref(post) !== '/posts';
  // "New post on this day" starts at nine in the morning; today it keeps the
  // composer's own default of an hour from now.
  const newPostHref = (key: string) => (key === todayKey ? '/compose' : `/compose?at=${key}T09:00`);
  /** An awareness day as a post idea: the composer opens on that day with a first line written. */
  const ideaHref = (key: string, name: string) =>
    `${newPostHref(key)}${key === todayKey ? '?' : '&'}text=${encodeURIComponent(t('ideaStart', { day: name }))}`;
  // Moving through the months keeps the Pages and the label being looked at.
  const keep = new URLSearchParams();
  for (const key of ['group', 'pages', 'label', 'drafts', 'status']) {
    const value = Array.isArray(params[key]) ? params[key][0] : params[key];
    if (value) keep.set(key, value);
  }
  const kept = keep.toString();
  const monthHref = (date: Date) =>
    `/calendar?month=${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}${kept ? `&${kept}` : ''}`;
  const weekKey = (date: Date) => formatInZone(date, timezone, 'yyyy-MM-dd');
  const weekHref = (key: string) => `/calendar?view=week&week=${key}${kept ? `&${kept}` : ''}`;
  const shift = (days7: number) => weekKey(new Date(days[0]!.getTime() + days7 * 86_400_000 + 12 * 3_600_000));
  // A link that keeps everything but one parameter.
  const linkWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [name, raw] of Object.entries(params)) {
      const v = Array.isArray(raw) ? raw[0] : raw;
      if (v && !(name in changes)) next.set(name, v);
    }
    for (const [name, value] of Object.entries(changes)) if (value) next.set(name, value);
    const qs = next.toString();
    return qs ? `/calendar?${qs}` : '/calendar';
  };
  const previousHref = view === 'week' ? weekHref(shift(-7)) : monthHref(previous);
  const nextHref = view === 'week' ? weekHref(shift(7)) : monthHref(next);
  const title =
    view === 'week'
      ? `${formatInZone(days[0]!, timezone, 'd MMM')} – ${formatInZone(days[6]!, timezone, 'd MMM yyyy')}`
      : monthLabel;
  const labelById = new Map(labels.map((label) => [label.id, label]));

  // The month at a glance, above the grid: what is planned and what went out.
  const inMonthPosts =
    view === 'week'
      ? posts
      : posts.filter(
          (post) => post.scheduledAt && Number(formatInZone(post.scheduledAt, timezone, 'M')) - 1 === safeMonth,
        );
  const summary = LEGEND.map((status) => ({
    status,
    count: inMonthPosts.filter((post) => post.status === status).length,
  })).filter((entry) => entry.count > 0);

  // Status pills filter the grid; counts stay those of the whole month.
  const shownStatuses = new Set((pick('status') ?? '').split(',').filter((status) => LEGEND.includes(status)));
  const statusHref = (status: string) => {
    const next = new Set(shownStatuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    return linkWith({ status: next.size > 0 ? [...next].join(',') : null });
  };
  if (shownStatuses.size > 0) {
    for (const [key, list] of byDay) byDay.set(key, list.filter((post) => shownStatuses.has(post.status)));
  }

  type CalendarPost = (typeof posts)[number];
  /** One planned post as the grid draws it: Page, time, labels, opening words and picture. */
  const renderChip = (post: CalendarPost) => (
        <Link
          href={postHref(post)}
          {...(movable(post) && post.scheduledAt
            ? { draggable: true, 'data-drag-post': post.id, 'data-drag-time': formatInZone(post.scheduledAt, timezone, 'HH:mm') }
            : { draggable: false })}
          className={`relative block overflow-hidden rounded-md border-s-[3px] bg-white px-2 py-1.5 shadow-surface transition-shadow hover:shadow-md ${
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
            <span className="sr-only">{tStatus(`post.${post.status}`)}</span>
            {post._count.notes > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-slate-500" title={t('notesCount', { count: post._count.notes })}>
                <Icon name="comment" className="h-3 w-3" />
                <span aria-hidden>{post._count.notes}</span>
                <span className="sr-only">{t('notesCount', { count: post._count.notes })}</span>
              </span>
            )}
            {post.labels.length > 0 && (
              <span className="ms-auto flex shrink-0 items-center gap-0.5">
                {post.labels.slice(0, 3).map((row) => {
                  const label = labelById.get(row.labelId);
                  return label ? (
                    <span
                      key={row.labelId}
                      title={label.name}
                      className={`h-2 w-2 rounded-full ${paletteOf(label.color).dot}`}
                    />
                  ) : null;
                })}
              </span>
            )}
          </span>
          {/* The planner's chip: the photo beside the opening words,
              as Meta Business Suite draws a planned post. */}
          <span className="mt-0.5 flex items-start gap-1.5">
            <span className="line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere] text-xs leading-tight text-slate-700">
              {post.message || post.link || tPosts('mediaOnly')}
            </span>
            {firstImage(post.media) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={firstImage(post.media)!}
                alt=""
                loading="lazy"
                className="hidden h-7 w-7 shrink-0 rounded object-cover sm:block"
              />
            )}
          </span>
        </Link>
  );

  const tools = (
    <div className="flex flex-col gap-2 [&_.btn-primary]:w-full [&_.btn-secondary]:w-full">
          <nav className="segmented" aria-label={t('viewLabel')}>
            {(['month', 'week', 'feed'] as const).map((option) => (
              <Link
                key={option}
                href={
                  option === 'week'
                    ? linkWith({ view: 'week', week: view === 'week' ? anchor : formatInZone(today, timezone, 'yyyy-MM-dd'), month: null })
                    : option === 'feed'
                      ? linkWith({ view: 'feed', week: null, month: null })
                      : linkWith({ view: null, week: null })
                }
                aria-current={view === option ? 'page' : undefined}
                className={`segmented-item ${view === option ? 'segmented-item-active' : ''}`}
              >
                {t(option === 'week' ? 'viewWeek' : option === 'feed' ? 'viewFeed' : 'viewMonth')}
              </Link>
            ))}
          </nav>
          <Link
            href={linkWith({ drafts: hideDrafts ? null : 'hide' })}
            role="switch"
            aria-checked={!hideDrafts}
            className="flex h-10 items-center gap-2 rounded-full bg-white px-3 text-sm font-semibold text-slate-700 shadow-surface hover:bg-slate-50"
          >
            <span
              aria-hidden
              className={`relative h-5 w-9 rounded-full transition-colors ${hideDrafts ? 'bg-slate-300' : 'bg-brand-500'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${hideDrafts ? 'start-0.5' : 'start-[18px]'}`} />
            </span>
            {t('showDrafts')}
          </Link>
          <LabelFilter labels={labels} active={activeLabel?.id ?? null} />
          {aiOn && (
            <AiPlanner
              pages={filter.pages.map((page) => ({ id: page.id, name: page.name, pictureUrl: page.pictureUrl }))}
              defaultPageId={feedPageId ?? (filter.visible?.length === 1 ? filter.visible[0]! : null)}
              tomorrow={formatInZone(new Date(today.getTime() + 24 * 60 * 60 * 1000), timezone, 'yyyy-MM-dd')}
            />
          )}
          <CalendarFeedButton
            pageIds={filter.visible ?? []}
            groupId={filter.group}
            selection={
              filter.group
                ? (filter.groups.find((entry) => entry.id === filter.group)?.name ?? '')
                : filter.visible
                  ? t('feedPages', { count: filter.visible.length })
                  : t('feedAllPages')
            }
          />
          <Link href="/compose" className="btn-primary">
            {tDash('newPost')}
          </Link>
    </div>
  );

  return (
    <ChannelsLayout auth={auth} selection={filter} tools={tools}>
    <div className="min-w-0 flex-1 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold capitalize sm:text-2xl text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {t('title')} · {t('timesShownIn', { timezone })}
            {view !== 'feed' && <span className="hidden sm:inline"> · {t('dragHint')}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view !== 'feed' && (
          <>
          <Link
            href={view === 'week' ? weekHref(formatInZone(today, timezone, 'yyyy-MM-dd')) : kept ? `/calendar?${kept}` : '/calendar'}
            className="btn-secondary"
          >
            {t('today')}
          </Link>
          <Link
            href={previousHref}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-900 hover:bg-slate-300"
            aria-label={view === 'week' ? t('previousWeek') : t('previousMonth')}
            title={view === 'week' ? t('previousWeek') : t('previousMonth')}
          >
            <Icon name="chevronLeft" size={18} />
          </Link>
          <Link
            href={nextHref}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-900 hover:bg-slate-300"
            aria-label={view === 'week' ? t('nextWeek') : t('nextMonth')}
            title={view === 'week' ? t('nextWeek') : t('nextMonth')}
          >
            <Icon name="chevronRight" size={18} />
          </Link>
          </>
          )}
        </div>
      </header>

      {view !== 'feed' && summary.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label={t('monthSummary')}>
          {summary.map((entry) => {
            const on = shownStatuses.has(entry.status);
            return (
              <li key={entry.status}>
                <Link
                  href={statusHref(entry.status)}
                  aria-pressed={on}
                  title={on ? t('statusFilterOff') : t('statusFilterOn')}
                  scroll={false}
                  className={`flex min-h-[36px] items-center gap-2 rounded-full px-3 py-1.5 text-sm shadow-surface ${
                    on ? 'bg-brand-50 ring-2 ring-brand-500' : shownStatuses.size > 0 ? 'bg-white opacity-60 hover:opacity-100' : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[entry.status]}`} />
                  <span className="nums font-semibold text-slate-900">{entry.count}</span>
                  <StatusBadge status={entry.status} />
                </Link>
              </li>
            );
          })}
          {shownStatuses.size > 0 && (
            <li>
              <Link href={linkWith({ status: null })} scroll={false} className="text-sm font-semibold text-brand-700 hover:underline">
                {t('statusFilterClear')}
              </Link>
            </li>
          )}
        </ul>
      )}

      {view === 'feed' ? (
        feedPage ? (
          <PageFeedPreview
            page={{
              name: feedPage.name,
              pictureUrl: feedPage.pictureUrl,
              category: feedPage.category,
              followers: feedPage.followersCount ?? feedPage.fanCount,
            }}
            labels={{
              followers:
                (feedPage.followersCount ?? feedPage.fanCount) !== null
                  ? t('feedFollowers', { count: feedPage.followersCount ?? feedPage.fanCount ?? 0 })
                  : null,
              upcoming: t('feedUpcoming', { count: feedUpcoming.length }),
              upcomingEmpty: t('feedUpcomingEmpty'),
              recent: t('feedRecent'),
              noText: tPosts('mediaOnly'),
              seeMore: tCommon('seeMore'),
            }}
            upcoming={feedUpcoming.map((post) => ({
              id: post.id,
              message: post.message,
              meta: post.scheduledAt ? formatInZone(post.scheduledAt, timezone, 'EEEE d MMMM, HH:mm') : t('feedNoTime'),
              badge: <StatusBadge status={post.status} />,
              href: postHref(post),
              media: feedMediaOf(post.media),
              link: post.link,
              linkPreview: feedLinkOf(post.linkPreview),
            }))}
            recent={feedRecent.map((row) => ({
              id: row.id,
              message: row.message,
              meta: row.at ? formatInZone(row.at, timezone, 'd MMMM, HH:mm') : '',
              media: row.media,
              link: row.link,
              linkPreview: row.linkPreview,
            }))}
          />
        ) : (
          <div className="card p-8 text-center text-sm text-slate-600">{t('feedNoPage')}</div>
        )
      ) : (
      <CalendarDrag timeZone={timezone} todayKey={todayKey}>
      {view === 'week' ? (
        <WeekGrid
          days={days}
          timeZone={timezone}
          todayKey={todayKey}
          nowMs={today.getTime()}
          postsByDay={byDay}
          renderChip={renderChip}
          newPostLabel={(date: Date) => t('newPostOn', { date: dayLabel.format(date) })}
          weekdayName={weekdayName}
          weekStartsOn={weekStartsOn}
          dayName={(key: string) => keyDaysOn(key).map((entry) => entry.name)}
          ideaHref={(key: string, name: string) => (key >= todayKey ? ideaHref(key, name) : null)}
        />
      ) : (
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-white">
          {/* The workspace's first day first, matching monthGrid. */}
          {[0, 1, 2, 3, 4, 5, 6].map((index) => (weekStartsOn + index) % 7).map((day) => (
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
                data-drop-day={key}
                className={`group/day min-h-[8rem] min-w-0 border-b border-e border-slate-200 p-1 sm:p-2 ${
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
                    {/* Day actions: shown on hover or keyboard focus where there is a pointer, always on touch. */}
                    <Link
                      href={linkWith({ view: 'week', week: key, month: null })}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-brand-50 hover:text-brand-600 focus-visible:bg-brand-50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover/day:opacity-100"
                      aria-label={t('openWeekOf', { date: dayLabel.format(day) })}
                      title={t('openWeekOf', { date: dayLabel.format(day) })}
                    >
                      <Icon name="calendar" size={13} />
                    </Link>
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

                {keyDaysOn(key).length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {keyDaysOn(key).map((entry) => (
                      <li key={entry.id}>
                        <Link
                          href={key >= todayKey ? ideaHref(key, entry.name) : '#'}
                          className={`flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] font-semibold hover:bg-emerald-50 ${entry.kind === 'custom' ? 'text-brand-700' : 'text-emerald-700'}`}
                          title={entry.name}
                        >
                          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.kind === 'custom' ? 'bg-brand-500' : 'bg-emerald-500'}`} />
                          <span className="truncate">{entry.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="mt-1 space-y-1">
                  {dayPosts.slice(0, 3).map((post) => (
                    <li key={post.id}>
                      {renderChip(post)}
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
      )}
      </CalendarDrag>
      )}

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
    </ChannelsLayout>
  );
}

function firstImage(media: Parameters<typeof parseMedia>[0]): string | null {
  return parseMedia(media).find((item) => item.kind === 'image')?.url ?? null;
}
