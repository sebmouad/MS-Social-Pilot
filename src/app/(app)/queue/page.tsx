import { getLocale, getTranslations } from 'next-intl/server';
import { TargetType } from '@prisma/client';

import { QueueClient } from '@/components/QueueClient';
import { requirePage } from '@/lib/auth';
import {
  QUEUE_OCCUPYING_STATUSES,
  canManageOthersPosts,
  canManageSettings,
  postIsEditable,
} from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { loadPagePosts } from '@/lib/page-analysis-data';
import { prisma } from '@/lib/prisma';
import { suggestSlots, upcomingOccurrences } from '@/lib/queue-suggestions';
import { localInputToUtc } from '@/lib/time';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('queue.title');
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** History the suggestions draw on: the same ninety days as the best-time grid. */
const LOOKBACK_DAYS = 90;
const UPCOMING_DAYS = 7;

/** Localised weekday names, 0 = Sunday. */
function weekdayNames(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(Date.UTC(2024, 0, 7 + day))));
}

/**
 * The posting queue: when "add to queue" posts go out, what is filling the
 * next week of it, and — from the Pages' own results — when else is worth
 * adding.
 */
export default async function QueuePage() {
  const auth = await requirePage();
  const t = await getTranslations('queue');
  const locale = await getLocale();
  const timeZone = auth.workspace.timezone;
  const now = new Date();

  const [slots, pages, taken] = await Promise.all([
    prisma.queueSlot.findMany({
      where: { workspaceId: auth.workspace.id },
      orderBy: [{ dayOfWeek: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
      select: { dayOfWeek: true, hour: true, minute: true },
    }),
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, type: TargetType.page },
      select: { id: true, name: true },
    }),
    prisma.post.findMany({
      where: {
        workspaceId: auth.workspace.id,
        status: { in: [...QUEUE_OCCUPYING_STATUSES] },
        scheduledAt: { gte: now, lte: new Date(now.getTime() + (UPCOMING_DAYS + 1) * DAY_MS) },
      },
      select: {
        id: true,
        message: true,
        scheduledAt: true,
        status: true,
        authorId: true,
        targets: { select: { status: true } },
      },
    }),
  ]);

  const history = await Promise.all(
    pages.map(async (page) => ({
      pageName: page.name,
      posts: await loadPagePosts(page.id, new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS), now),
    })),
  );

  const suggestions = suggestSlots({ pages: history, timeZone, existing: slots });
  const sample = history.reduce((sum, page) => sum + page.posts.length, 0);

  // In the reader's language: the rest of the app's dates are still English
  // under a French interface, and a new screen need not add to that.
  const when = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    // The 24-hour clock, like every other time on the screen and the slots it
    // lists; a queue of "09:00" slots should not come up as "09:00 AM".
    hourCycle: 'h23',
    timeZone,
  });

  const byTime = new Map(taken.map((post) => [post.scheduledAt!.getTime(), post]));
  // The calendar's rule: a post this person can still change opens in the
  // composer, anything else opens the list, which says why it cannot be.
  const manageOthers = canManageOthersPosts(auth.role);
  const editable = (post: (typeof taken)[number]) =>
    postIsEditable(post) && (manageOthers || post.authorId === auth.user.id);
  const upcoming = upcomingOccurrences({ slots, timeZone, from: now, days: UPCOMING_DAYS, toUtc: localInputToUtc })
    .filter((entry) => entry.at.getTime() <= now.getTime() + UPCOMING_DAYS * DAY_MS)
    .map((entry) => {
      const post = byTime.get(entry.at.getTime());
      return {
        iso: entry.at.toISOString(),
        label: when.format(entry.at),
        weekday: entry.slot.dayOfWeek,
        post: post
          ? {
              id: post.id,
              message: post.message,
              pending: post.status === 'pending_approval',
              editable: editable(post),
            }
          : null,
      };
    });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle', { timezone: timeZone })}</p>
      </header>

      <QueueClient
        canManage={canManageSettings(auth.role)}
        slots={slots}
        suggestions={suggestions}
        upcoming={upcoming}
        weekdays={weekdayNames(locale)}
        sample={sample}
        pageCount={pages.length}
      />
    </div>
  );
}
