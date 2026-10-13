/**
 * Negative-comment alert. For workspaces that switch it on,
 * the worker reads the mood of new comments with AI, a batch at a time, and
 * emails the team when a Page gets clearly more negative comments than usual.
 * Reads stored comments only: no Graph call. AI cost goes through the usual
 * hourly limit and monthly budget.
 */
import { WorkspaceRole } from '@prisma/client';

import { aiAvailable, readCommentSentiments } from './ai';
import { notifyNegativeSpike } from './email/notify';
import { prisma } from './prisma';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Comments read per workspace per run: one AI call. */
const BATCH = 40;
/** Comments older than this are not worth an AI call any more. */
const FRESH_MS = 48 * HOUR_MS;
const BASELINE_DAYS = 14;
const MIN_NEGATIVE = 3;
const SPIKE_FACTOR = 2;

/** A spike: a few negative comments today, and at least twice the usual daily number. */
export function isNegativeSpike(today: number, baselinePerDay: number): boolean {
  return today >= MIN_NEGATIVE && today >= SPIKE_FACTOR * baselinePerDay;
}

async function workspacesWatching() {
  if (!aiAvailable()) return [];
  return prisma.workspace.findMany({
    where: { watchNegativeComments: true, aiEnabled: true, suspendedAt: null },
    select: { id: true, memberships: { where: { role: WorkspaceRole.owner }, select: { userId: true }, take: 1 } },
  });
}

/** Read the mood of the newest unread comments. Returns how many were read. */
async function readMoods(workspaceId: string, userId: string, now: Date): Promise<number> {
  const candidates = await prisma.postComment.findMany({
    where: {
      sentiment: null,
      isHidden: false,
      createdTime: { gte: new Date(now.getTime() - FRESH_MS) },
      postTarget: { target: { workspaceId } },
    },
    select: { id: true, message: true, fromId: true, sentById: true, postTarget: { select: { target: { select: { providerId: true } } } } },
    orderBy: { createdTime: 'desc' },
    take: BATCH * 3,
  });
  // The Page's own replies are not people's mood: mark them so they are not read again.
  const own = candidates.filter((comment) => comment.sentById || comment.fromId === comment.postTarget.target.providerId || !comment.message.trim());
  if (own.length) await prisma.postComment.updateMany({ where: { id: { in: own.map((comment) => comment.id) } }, data: { sentiment: 'neutral' } });
  const batch = candidates.filter((comment) => !own.includes(comment)).slice(0, BATCH);
  if (batch.length === 0) return 0;

  const moods = await readCommentSentiments({ workspaceId, userId, comments: batch.map((comment) => comment.message) });
  for (const [index, comment] of batch.entries()) {
    const mood = moods[index];
    if (mood) await prisma.postComment.update({ where: { id: comment.id }, data: { sentiment: mood } });
  }
  return moods.filter(Boolean).length;
}

/** Alert on each Page whose negative comments spiked; once a day per Page at most. */
async function alertSpikes(workspaceId: string, now: Date): Promise<number> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const targets = await prisma.target.findMany({
    where: { workspaceId, type: 'page', OR: [{ negativeAlertAt: null }, { negativeAlertAt: { lt: dayAgo } }] },
    select: { id: true, name: true },
  });
  let alerted = 0;
  for (const target of targets) {
    const negative = (from: Date, to: Date) =>
      prisma.postComment.count({ where: { sentiment: 'negative', postTarget: { targetId: target.id }, createdTime: { gte: from, lt: to } } });
    const today = await negative(dayAgo, now);
    if (today < MIN_NEGATIVE) continue;
    const before = await negative(new Date(dayAgo.getTime() - BASELINE_DAYS * DAY_MS), dayAgo);
    if (!isNegativeSpike(today, before / BASELINE_DAYS)) continue;
    await prisma.target.update({ where: { id: target.id }, data: { negativeAlertAt: now } });
    await notifyNegativeSpike({ workspaceId, targetId: target.id, page: target.name, count: today });
    alerted += 1;
  }
  return alerted;
}

export async function watchNegativeComments(now: Date = new Date()): Promise<{ read: number; alerted: number }> {
  let read = 0;
  let alerted = 0;
  for (const workspace of await workspacesWatching()) {
    const userId = workspace.memberships[0]?.userId;
    if (!userId) continue;
    try {
      read += await readMoods(workspace.id, userId, now);
    } catch (error) {
      // Over the AI limit or budget, or the provider failed: try again next run.
      console.error('[negative-comments] could not read comments', workspace.id, error);
    }
    alerted += await alertSpikes(workspace.id, now);
  }
  return { read, alerted };
}
