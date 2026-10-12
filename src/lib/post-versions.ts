/**
 * Post version history (NEXT_PHASES H9): every save of a post keeps a copy of
 * what it said, where and when it was going, and who saved it. Compose lists
 * them, compares them and loads one back; restoring is an ordinary save, so
 * every check and the approval rules apply to it.
 */
import type { Prisma } from '@prisma/client';

import { prisma } from './prisma';
import { parseMedia } from './json';
import { utcToLocalInput } from './time';
import type { PostVersionView } from './post-version-diff';

/** Versions kept per post; the oldest go first. */
export const MAX_VERSIONS = 50;

/**
 * Store the post as it stands now, unless nothing changed since the last
 * version (a save that only touched settings that are not versioned).
 */
export async function recordVersion(postId: string, authorId: string | null): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      message: true,
      firstComment: true,
      link: true,
      media: true,
      format: true,
      scheduledAt: true,
      timezone: true,
      targets: { select: { targetId: true } },
      labels: { select: { labelId: true } },
    },
  });
  if (!post) return;
  const snapshot = {
    message: post.message,
    firstComment: post.firstComment,
    link: post.link,
    media: post.media as Prisma.InputJsonValue,
    format: post.format,
    targetIds: post.targets.map((row) => row.targetId).sort(),
    labelIds: post.labels.map((row) => row.labelId).sort(),
    scheduledAt: post.scheduledAt,
    timezone: post.timezone,
  };

  const last = await prisma.postVersion.findFirst({ where: { postId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  if (
    last &&
    last.message === snapshot.message &&
    last.firstComment === snapshot.firstComment &&
    last.link === snapshot.link &&
    JSON.stringify(last.media) === JSON.stringify(snapshot.media) &&
    last.format === snapshot.format &&
    last.targetIds.join() === snapshot.targetIds.join() &&
    last.labelIds.join() === snapshot.labelIds.join() &&
    last.scheduledAt?.getTime() === snapshot.scheduledAt?.getTime()
  ) {
    return;
  }

  await prisma.postVersion.create({ data: { postId, authorId, ...snapshot } });
  const stale = await prisma.postVersion.findMany({
    where: { postId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: MAX_VERSIONS,
    select: { id: true },
  });
  if (stale.length > 0) await prisma.postVersion.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
}

/** A post's versions, newest first, times in the workspace's zone. */
export async function listVersions(postId: string, timeZone: string): Promise<PostVersionView[]> {
  const rows = await prisma.postVersion.findMany({
    where: { postId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { author: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    authorName: row.author?.name ?? null,
    message: row.message,
    firstComment: row.firstComment,
    link: row.link,
    media: parseMedia(row.media),
    format: row.format,
    targetIds: row.targetIds,
    labelIds: row.labelIds,
    scheduledAtLocal: row.scheduledAt ? utcToLocalInput(row.scheduledAt, timeZone) : null,
  }));
}
