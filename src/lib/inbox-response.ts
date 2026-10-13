/**
 * Inbox response time, read from what the sync stored:
 * comments on the Pages' posts and Messenger threads. Nothing here asks
 * Facebook anything, so the screen costs no Graph calls.
 */
import { prisma } from './prisma';
import { commentWaits, messageWaits, summariseWaits, type BusinessHours, type ResponseSummary, type Wait } from './response-time';

/** Enough for a busy Page's month; past that the figures are a sample of the latest. */
const ROW_CAP = 20_000;

export interface PageResponse {
  targetId: string;
  name: string;
  comments: ResponseSummary;
  messages: ResponseSummary;
}

export interface MemberResponse {
  /** null: answered on Facebook itself, not from this app. */
  userId: string | null;
  name: string | null;
  summary: ResponseSummary;
}

export interface ResponseTimes {
  pages: PageResponse[];
  members: MemberResponse[];
}

export function businessHoursOf(workspace: { businessDays: number[]; businessStart: number; businessEnd: number }): BusinessHours | null {
  return workspace.businessDays.length > 0 ? { days: workspace.businessDays, start: workspace.businessStart, end: workspace.businessEnd } : null;
}

export async function readResponseTimes(input: {
  workspaceId: string;
  targetIds: string[];
  from: Date;
  /** Exclusive. */
  to: Date;
  timeZone: string;
  hours: BusinessHours | null;
}): Promise<ResponseTimes> {
  const { workspaceId, from, to, timeZone, hours } = input;
  const targets = await prisma.target.findMany({
    where: { workspaceId, id: { in: input.targetIds } },
    select: { id: true, name: true, providerId: true },
    orderBy: { name: 'asc' },
  });
  const inWindow = (wait: Wait) => wait.startedAt >= from && wait.startedAt < to;
  const allWaits: Wait[] = [];

  const pages: PageResponse[] = [];
  for (const target of targets) {
    // Replies can come after the window closes; they still answer a comment made in it.
    const comments = await prisma.postComment.findMany({
      where: { postTarget: { targetId: target.id }, createdTime: { gte: from } },
      select: { remoteId: true, parentRemoteId: true, fromId: true, createdTime: true, resolvedAt: true, sentById: true },
      orderBy: { createdTime: 'asc' },
      take: ROW_CAP,
    });
    const commentList = commentWaits(comments, target.providerId).filter(inWindow);

    const conversations = await prisma.conversation.findMany({
      where: { targetId: target.id, updatedTime: { gte: from } },
      select: {
        resolvedAt: true,
        messages: { where: { createdTime: { gte: from } }, select: { fromId: true, createdTime: true, sentById: true } },
      },
      take: ROW_CAP,
    });
    const messageList = conversations.flatMap((thread) => messageWaits(thread.messages, target.providerId, thread.resolvedAt)).filter(inWindow);

    allWaits.push(...commentList, ...messageList);
    pages.push({
      targetId: target.id,
      name: target.name,
      comments: summariseWaits(commentList, hours, timeZone),
      messages: summariseWaits(messageList, hours, timeZone),
    });
  }

  // Who answered: each member's first answers, and those given on Facebook.
  const byMember = new Map<string | null, Wait[]>();
  for (const wait of allWaits) {
    if (!wait.answeredAt) continue;
    byMember.set(wait.answeredBy, [...(byMember.get(wait.answeredBy) ?? []), wait]);
  }
  const ids = [...byMember.keys()].filter((id): id is string => id !== null);
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name || user.email]));
  const members = [...byMember.entries()]
    .map(([userId, waits]) => ({ userId, name: userId ? (names.get(userId) ?? null) : null, summary: summariseWaits(waits, hours, timeZone) }))
    .sort((a, b) => b.summary.answered - a.summary.answered);

  return { pages, members };
}
