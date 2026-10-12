/**
 * Private calendar feeds (NEXT_PHASES H19): a member subscribes Google
 * Calendar or Outlook to their planned posts. The address carries a random
 * token (stored hashed, shown once); reading it narrows to the Pages the feed
 * was made for and, every time, to the Pages the member may still see. A
 * member who leaves the workspace leaves a dead address.
 */
import { PostStatus } from '@prisma/client';

import { prisma } from './prisma';
import { env } from './env';
import { errors } from './errors';
import { hashToken, randomToken } from './crypto';
import { postIsEditable } from './constants';
import { scopeOf, targetScope, type PageScope } from './page-access';
import { buildCalendar, type IcsEvent } from './ics';

/** How far back and ahead a feed reaches. */
const PAST_DAYS = 30;
const AHEAD_DAYS = 180;
const MAX_EVENTS = 1000;

export interface CalendarFeedView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function feedUrl(token: string): string {
  return `${env.appUrl}/api/calendar-feed/${token}`;
}

export async function listFeeds(workspaceId: string, userId: string): Promise<CalendarFeedView[]> {
  const rows = await prisma.calendarFeed.findMany({ where: { workspaceId, userId }, orderBy: { createdAt: 'desc' } });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

/**
 * A new feed for some Pages, a group, or (neither) every Page the member may
 * see. Ids outside the member's reach are refused, not dropped.
 */
export async function createFeed(options: {
  workspaceId: string;
  userId: string;
  pageScope: PageScope;
  pageIds: string[];
  groupId: string | null;
  allName: string;
}): Promise<{ feed: CalendarFeedView; url: string }> {
  let name = options.allName;
  if (options.groupId) {
    const group = await prisma.pageGroup.findFirst({ where: { id: options.groupId, workspaceId: options.workspaceId }, select: { name: true } });
    if (!group) throw errors.notFound();
    name = group.name;
  } else if (options.pageIds.length > 0) {
    const pages = await prisma.target.findMany({
      where: { workspaceId: options.workspaceId, AND: [{ id: { in: options.pageIds } }, targetScope(options.pageScope)] },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    if (pages.length !== new Set(options.pageIds).size) throw errors.notFound();
    name = pages.map((page) => page.name).join(', ').slice(0, 120);
  }

  const token = randomToken();
  const row = await prisma.calendarFeed.create({
    data: {
      workspaceId: options.workspaceId,
      userId: options.userId,
      name,
      tokenHash: hashToken(token),
      pageIds: options.groupId ? [] : [...new Set(options.pageIds)],
      groupId: options.groupId,
    },
  });
  return { feed: { id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), lastUsedAt: null }, url: feedUrl(token) };
}

export async function revokeFeed(workspaceId: string, userId: string, feedId: string): Promise<void> {
  const { count } = await prisma.calendarFeed.deleteMany({ where: { id: feedId, workspaceId, userId } });
  if (count === 0) throw errors.notFound();
}

/** The ICS text behind a token, or null when the token or its member is gone. */
export async function renderFeed(token: string, now: Date = new Date()): Promise<string | null> {
  const feed = await prisma.calendarFeed.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!feed) return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: feed.userId, workspaceId: feed.workspaceId } },
    include: { pages: { select: { targetId: true } } },
  });
  if (!membership) return null;

  let wanted: string[] | null = feed.pageIds.length > 0 ? feed.pageIds : null;
  if (feed.groupId) {
    const rows = await prisma.pageGroupTarget.findMany({ where: { groupId: feed.groupId, group: { workspaceId: feed.workspaceId } }, select: { targetId: true } });
    wanted = rows.map((row) => row.targetId);
  }
  const pages = await prisma.target.findMany({
    where: {
      workspaceId: feed.workspaceId,
      AND: [targetScope(scopeOf(membership)), wanted ? { id: { in: wanted } } : {}],
    },
    select: { id: true, name: true },
  });
  const pageName = new Map(pages.map((page) => [page.id, page.name]));

  const posts = await prisma.post.findMany({
    where: {
      workspaceId: feed.workspaceId,
      status: { in: [PostStatus.scheduled, PostStatus.pending_approval, PostStatus.published, PostStatus.publishing, PostStatus.partially_failed, PostStatus.failed] },
      scheduledAt: { gte: new Date(now.getTime() - PAST_DAYS * 86_400_000), lte: new Date(now.getTime() + AHEAD_DAYS * 86_400_000) },
      targets: { some: { targetId: { in: [...pageName.keys()] } } },
    },
    select: { id: true, message: true, link: true, status: true, scheduledAt: true, updatedAt: true, targets: { select: { targetId: true, status: true } } },
    orderBy: { scheduledAt: 'asc' },
    take: MAX_EVENTS,
  });

  await prisma.calendarFeed.update({ where: { id: feed.id }, data: { lastUsedAt: now } });

  const host = new URL(env.appUrl).host;
  const events: IcsEvent[] = posts.map((post) => {
    const names = post.targets.map((target) => pageName.get(target.targetId)).filter((name): name is string => Boolean(name));
    const text = (post.message || post.link || '').replace(/\s+/g, ' ').trim();
    return {
      uid: `${post.id}@${host}`,
      start: post.scheduledAt!,
      minutes: 15,
      summary: `${names.join(', ')}: ${text.slice(0, 80) || '—'}`,
      description: `${post.message}${post.link ? `\n\n${post.link}` : ''}`,
      url: postIsEditable(post) ? `${env.appUrl}/compose?post=${post.id}` : `${env.appUrl}/posts`,
      updated: post.updatedAt,
    };
  });
  return buildCalendar(feed.name, events, now);
}
