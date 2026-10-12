import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { toCsv } from './csv';
import { readStoredFile, resolveStoragePath } from './media';
import { prisma } from './prisma';
import { ZIP_MAX_BYTES, ZipWriter } from './zip';

/**
 * Export everything (NEXT_PHASES G17): one workspace's posts, schedule,
 * analytics, comments and media as a ZIP of JSON, CSV and files, built by the
 * worker and downloadable for a week. Never includes tokens or secrets.
 * Database and disk only, no Graph call.
 */

export const EXPORT_DAYS = 7;
/** A build still "building" after this long died with its worker. */
const STUCK_MS = 60 * 60 * 1000;
/** ZIP without ZIP64 holds at most 65,535 entries. */
const MAX_MEDIA_FILES = 60_000;
const PAGE = 1000;

/** Ask for an export; an unfinished one is returned instead of a second. */
export async function requestExport(workspaceId: string, userId: string) {
  const pending = await prisma.workspaceExport.findFirst({ where: { workspaceId, status: { in: ['queued', 'building'] } } });
  return pending ?? prisma.workspaceExport.create({ data: { workspaceId, requestedById: userId } });
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const iso = (value: Date | null | undefined) => value?.toISOString() ?? '';
const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(0, 80);

async function writeContents(zip: ZipWriter, workspaceId: string): Promise<{ skippedMedia: number }> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, timezone: true } });
  const pages = await prisma.target.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      type: true,
      providerId: true,
      name: true,
      category: true,
      enabled: true,
      brandVoice: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      audienceCountries: true,
      audienceLanguages: true,
      audienceTimezone: true,
      audienceCalendars: true,
    },
  });
  const pageName = new Map(pages.map((page) => [page.id, page.name]));
  await zip.add(
    'README.txt',
    [
      `Export of "${workspace.name}" made ${new Date().toISOString()}.`,
      '',
      'pages.json            The Pages and accounts, their settings and audience (no access tokens).',
      'posts.json, posts.csv Every post with its destinations, status, times, links and last insights.',
      'schedule.json         Queue times (per Page or shared).',
      'analytics/pages.csv   Page insights as stored: Page, metric, period, end time, value.',
      'comments.json         Comments read from each published post.',
      'media/                The media library files.',
      '',
      `Times are UTC (ISO 8601). The workspace time zone is ${workspace.timezone}.`,
      '',
    ].join('\n'),
  );
  await zip.add('pages.json', json(pages));

  // Posts, a page at a time.
  const posts: unknown[] = [];
  const postRows: unknown[][] = [['post id', 'status', 'format', 'scheduled', 'published', 'page', 'destination status', 'url', 'message', 'link', 'labels']];
  for (let cursor: string | undefined; ; ) {
    const batch = await prisma.post.findMany({
      where: { workspaceId },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        message: true,
        firstComment: true,
        format: true,
        link: true,
        status: true,
        scheduledAt: true,
        timezone: true,
        publishedAt: true,
        approvalStatus: true,
        createdAt: true,
        media: true,
        labels: { select: { label: { select: { name: true } } } },
        targets: {
          select: { id: true, targetId: true, status: true, remoteUrl: true, publishedAt: true, errorMessage: true, insights: true },
        },
      },
    });
    for (const post of batch) {
      const labels = post.labels.map((item) => item.label.name);
      posts.push({ ...post, labels, targets: post.targets.map((target) => ({ ...target, page: pageName.get(target.targetId) ?? null })) });
      for (const target of post.targets.length ? post.targets : [null]) {
        postRows.push([
          post.id,
          post.status,
          post.format,
          iso(post.scheduledAt),
          iso(target?.publishedAt ?? post.publishedAt),
          target ? (pageName.get(target.targetId) ?? '') : '',
          target?.status ?? '',
          target?.remoteUrl ?? '',
          post.message,
          post.link ?? '',
          labels.join('; '),
        ]);
      }
    }
    if (batch.length < PAGE) break;
    cursor = batch[batch.length - 1]!.id;
  }
  await zip.add('posts.json', json(posts));
  await zip.add('posts.csv', toCsv(postRows));

  const slots = await prisma.queueSlot.findMany({
    where: { workspaceId },
    orderBy: [{ dayOfWeek: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
    select: { targetId: true, dayOfWeek: true, hour: true, minute: true },
  });
  await zip.add('schedule.json', json(slots.map((slot) => ({ ...slot, page: slot.targetId ? (pageName.get(slot.targetId) ?? null) : null }))));

  const insightRows: unknown[][] = [['page', 'page id', 'metric', 'period', 'end time', 'value']];
  for (let cursor: string | undefined; ; ) {
    const batch = await prisma.pageInsight.findMany({
      where: { target: { workspaceId } },
      orderBy: { id: 'asc' },
      take: PAGE * 5,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, targetId: true, metric: true, period: true, endTime: true, value: true },
    });
    for (const row of batch) {
      insightRows.push([
        pageName.get(row.targetId) ?? '',
        row.targetId,
        row.metric,
        row.period,
        iso(row.endTime),
        typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value),
      ]);
    }
    if (batch.length < PAGE * 5) break;
    cursor = batch[batch.length - 1]!.id;
  }
  await zip.add('analytics/pages.csv', toCsv(insightRows));

  const comments = await prisma.postComment.findMany({
    where: { postTarget: { target: { workspaceId } } },
    orderBy: { createdTime: 'asc' },
    select: {
      postTarget: { select: { postId: true, targetId: true } },
      remoteId: true,
      parentRemoteId: true,
      message: true,
      fromName: true,
      likeCount: true,
      replyCount: true,
      isHidden: true,
      createdTime: true,
    },
  });
  await zip.add(
    'comments.json',
    json(comments.map(({ postTarget, ...comment }) => ({ postId: postTarget.postId, page: pageName.get(postTarget.targetId) ?? null, ...comment }))),
  );

  // Media last, stopping before the ZIP size limit.
  let skippedMedia = 0;
  let added = 0;
  const media = await prisma.media.findMany({
    where: { workspaceId, storageKey: { not: null }, derivedFromId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, filename: true, size: true, storageKey: true, createdAt: true },
  });
  for (const item of media) {
    if (added >= MAX_MEDIA_FILES || zip.bytes + item.size > ZIP_MAX_BYTES) {
      skippedMedia++;
      continue;
    }
    try {
      await zip.add(`media/${item.id}-${safeName(item.filename)}`, await readStoredFile(item.storageKey!), item.createdAt);
      added++;
    } catch {
      // A file gone from disk is left out, not a failed export.
      skippedMedia++;
    }
  }
  return { skippedMedia };
}

/** Build one queued export. */
export async function buildExport(id: string, now = new Date()): Promise<void> {
  const claimed = await prisma.workspaceExport.updateMany({ where: { id, status: 'queued' }, data: { status: 'building' } });
  if (claimed.count === 0) return;
  const entry = await prisma.workspaceExport.findUniqueOrThrow({ where: { id } });
  const storageKey = `exports/${entry.workspaceId}/${entry.id}.zip`;
  const absolute = resolveStoragePath(storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  const zip = new ZipWriter(absolute);
  try {
    const { skippedMedia } = await writeContents(zip, entry.workspaceId);
    const bytes = await zip.close();
    await prisma.workspaceExport.update({
      where: { id },
      data: {
        status: 'ready',
        storageKey,
        bytes,
        skippedMedia,
        finishedAt: now,
        expiresAt: new Date(now.getTime() + EXPORT_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  } catch (error) {
    zip.abort();
    await rm(absolute, { force: true });
    await prisma.workspaceExport.update({
      where: { id },
      data: { status: 'failed', finishedAt: now, error: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
    });
    throw error;
  }
}

/**
 * The worker's pass: expire old downloads, fail builds that died, then build
 * the oldest queued export (one per pass, so a big one does not hold up the
 * others' expiry).
 */
export async function runExports(now = new Date()): Promise<string | null> {
  const expired = await prisma.workspaceExport.findMany({ where: { status: 'ready', expiresAt: { lt: now } } });
  for (const entry of expired) {
    if (entry.storageKey) await rm(resolveStoragePath(entry.storageKey), { force: true });
    await prisma.workspaceExport.update({ where: { id: entry.id }, data: { status: 'expired', storageKey: null } });
  }
  await prisma.workspaceExport.updateMany({
    where: { status: 'building', createdAt: { lt: new Date(now.getTime() - STUCK_MS) } },
    data: { status: 'failed', error: 'The build stopped before it finished.', finishedAt: now },
  });
  const next = await prisma.workspaceExport.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } });
  if (next) await buildExport(next.id, now);
  const parts = [next ? `export ${next.id} built` : null, expired.length ? `${expired.length} export(s) expired` : null].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
