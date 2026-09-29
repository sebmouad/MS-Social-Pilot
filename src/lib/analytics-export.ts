import { prisma } from './prisma';
import { parseInsights } from './json';
import { readAdSummary, readCampaigns } from './ads';
import { readInstagramInsights, readInstagramMedia } from './instagram';
import { readComments, readExternalPosts, readReviews, readVideos } from './engagement';
import { toCsv as csvDocument } from './csv';

/**
 * CSV exports of the full analytics catalogue.
 *
 * The report screen shows a per-destination summary because that is what fits
 * on a page. These exports are the other half of "everything Facebook will give
 * us": one row per post with *one column per metric*, so nothing captured is
 * unreachable from a spreadsheet.
 *
 * Columns are derived from the data rather than from the catalogue. A file with
 * 354 mostly-empty columns is worse than useless — the header is built from the
 * metrics that actually came back for the rows being exported.
 */

export type ExportKind =
  | 'posts'
  | 'page'
  | 'external'
  | 'comments'
  | 'reviews'
  | 'videos'
  | 'instagram'
  | 'instagram_media'
  | 'ads';

function toCsv(header: string[], rows: unknown[][]): string {
  return csvDocument([header, ...rows]);
}

/** ISO day, which is what spreadsheets parse most reliably. */
function day(value: Date | null): string {
  return value ? value.toISOString().slice(0, 19).replace('T', ' ') : '';
}

interface Window {
  workspaceId: string;
  from: Date;
  to: Date;
  targetId?: string;
  /** Ads only: one ad account, already checked against the workspace. */
  adAccountId?: string;
}

/**
 * One row per published post per destination, one column per metric.
 *
 * This is the export people mean when they ask for "all the data": the seven
 * numbers the UI table can show, plus every other catalogue metric Graph
 * returned for that post, breakdown maps included as JSON so nothing is lost.
 */
export async function postMetricsCsv(options: Window): Promise<string> {
  const rows = await prisma.postTarget.findMany({
    where: {
      status: 'published',
      publishedAt: { gte: options.from, lte: options.to },
      post: { workspaceId: options.workspaceId },
      ...(options.targetId ? { targetId: options.targetId } : {}),
    },
    include: {
      target: { select: { name: true } },
      post: { select: { id: true, message: true } },
    },
    orderBy: { publishedAt: 'desc' },
  });

  const parsed = rows.map((row) => ({ row, insights: parseInsights(row.insights) }));

  // Union of every metric name present, sorted, so the header is stable for a
  // given export and diffable between two of them.
  const metricNames = [
    ...new Set(parsed.flatMap((entry) => Object.keys(entry.insights?.metrics ?? {}))),
  ].sort();

  const header = [
    'published_at',
    'destination',
    'post_id',
    'message',
    'url',
    'reactions',
    'comments',
    'shares',
    'synced_at',
    ...metricNames,
  ];

  const body = parsed.map(({ row, insights }) => [
    day(row.publishedAt),
    row.target.name,
    row.post.id,
    row.post.message,
    row.remoteUrl,
    insights?.reactions,
    insights?.comments,
    insights?.shares,
    day(row.insightsSyncedAt),
    ...metricNames.map((name) => insights?.metrics?.[name]),
  ]);

  return toCsv(header, body);
}

/** Every stored Page insight value: metric, period, window end, value. */
export async function pageInsightsCsv(options: Window): Promise<string> {
  const rows = await prisma.pageInsight.findMany({
    where: {
      endTime: { gte: options.from, lte: options.to },
      target: {
        workspaceId: options.workspaceId,
        ...(options.targetId ? { id: options.targetId } : {}),
      },
    },
    include: { target: { select: { name: true } } },
    orderBy: [{ metric: 'asc' }, { endTime: 'asc' }],
  });

  return toCsv(
    ['destination', 'metric', 'period', 'end_time', 'value'],
    rows.map((row) => [
      row.target.name,
      row.metric,
      row.period,
      day(row.endTime),
      // Breakdown maps keep their shape as JSON rather than collapsing to a
      // number that would mean nothing.
      row.numeric ?? row.value,
    ]),
  );
}

/** Posts that reached a Page without going through this app. */
export async function externalPostsCsv(options: Window): Promise<string> {
  const posts = await readExternalPosts({ ...options, limit: 2000 });

  return toCsv(
    [
      'created_at',
      'destination',
      'type',
      'message',
      'permalink',
      'impressions',
      'reach',
      'engaged_users',
      'reactions',
      'comments',
      'shares',
      'metrics_captured',
    ],
    posts.map((post) => [
      day(post.createdTime),
      post.targetName,
      post.statusType,
      post.message,
      post.permalink,
      post.impressions,
      post.reach,
      post.engagedUsers,
      post.reactions,
      post.comments,
      post.shares,
      post.metricCount,
    ]),
  );
}

export async function commentsCsv(options: Window): Promise<string> {
  const comments = await readComments({
    workspaceId: options.workspaceId,
    targetId: options.targetId,
    limit: 5000,
  });

  return toCsv(
    ['created_at', 'destination', 'author', 'comment', 'likes', 'replies', 'is_reply', 'hidden', 'on_post'],
    comments.map((comment) => [
      day(comment.createdTime),
      comment.targetName,
      comment.author,
      comment.message,
      comment.likeCount,
      comment.replyCount,
      comment.isReply,
      comment.isHidden,
      comment.postMessage,
    ]),
  );
}

export async function reviewsCsv(options: Window): Promise<string> {
  const reviews = await readReviews({
    workspaceId: options.workspaceId,
    targetId: options.targetId,
    limit: 5000,
  });

  return toCsv(
    ['created_at', 'reviewer', 'rating', 'recommendation', 'review'],
    reviews.recent.map((review) => [
      day(review.createdTime),
      review.reviewer,
      review.rating,
      review.recommendationType,
      review.text,
    ]),
  );
}

/** Videos, with the whole video-level catalogue spread across columns. */
export async function videosCsv(options: Window): Promise<string> {
  const videos = await readVideos({
    workspaceId: options.workspaceId,
    targetId: options.targetId,
    limit: 500,
  });

  const metricNames = [...new Set(videos.flatMap((video) => Object.keys(video.metrics)))].sort();

  return toCsv(
    ['created_at', 'destination', 'title', 'permalink', 'length_seconds', ...metricNames],
    videos.map((video) => [
      day(video.createdTime),
      video.targetName,
      video.title,
      video.permalink,
      video.lengthSeconds,
      ...metricNames.map((name) => video.metrics[name]),
    ]),
  );
}

export async function instagramCsv(options: Window): Promise<string> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId: options.workspaceId },
    select: { id: true, username: true },
  });

  const rows: unknown[][] = [];
  for (const account of accounts) {
    const series = await readInstagramInsights({
      accountId: account.id,
      from: options.from,
      to: options.to,
    });

    for (const entry of series) {
      for (const point of entry.points) {
        rows.push([account.username, entry.metric, entry.period, point.endTime, point.value]);
      }
    }
  }

  return toCsv(['account', 'metric', 'period', 'end_time', 'value'], rows);
}

export async function instagramMediaCsv(options: Window): Promise<string> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId: options.workspaceId },
    select: { id: true, username: true },
  });

  const collected: Array<{ username: string; media: Awaited<ReturnType<typeof readInstagramMedia>>[number] }> = [];
  for (const account of accounts) {
    for (const media of await readInstagramMedia({ accountId: account.id, limit: 500 })) {
      collected.push({ username: account.username, media });
    }
  }

  const metricNames = [
    ...new Set(collected.flatMap((entry) => Object.keys(entry.media.metrics))),
  ].sort();

  return toCsv(
    ['posted_at', 'account', 'type', 'caption', 'permalink', 'likes', 'comments', ...metricNames],
    collected.map(({ username, media }) => [
      day(media.timestamp),
      username,
      media.mediaType,
      media.caption,
      media.permalink,
      media.likeCount,
      media.commentsCount,
      ...metricNames.map((name) => media.metrics[name]),
    ]),
  );
}

/**
 * Spend by day and by campaign, ad set and ad — one ad account at a time.
 *
 * Every row names its ad account and that account's own currency, and nothing
 * is totalled across two accounts. This used to read the whole workspace in
 * one pass: two accounts billing in euros and dollars were added into one
 * daily figure, under a currency column left blank because no single one was
 * true. A spreadsheet sums whatever it is given, so the only safe file is one
 * where every number already carries the unit it was billed in.
 *
 * With `adAccountId` the file covers that account; without it, each enabled
 * account in turn, in its own block of rows.
 */
export async function adsCsv(options: Window): Promise<string> {
  const accounts = await prisma.adAccount.findMany({
    where: {
      workspaceId: options.workspaceId,
      ...(options.adAccountId ? { id: options.adAccountId } : { enabled: true }),
    },
    select: { id: true, name: true, currency: true },
    orderBy: { name: 'asc' },
  });

  const rows: unknown[][] = [];

  for (const account of accounts) {
    const scope = {
      workspaceId: options.workspaceId,
      adAccountId: account.id,
      from: options.from,
      to: options.to,
    };
    const summary = await readAdSummary(scope);
    const currency = account.currency ?? summary.currency ?? '';

    for (const entry of summary.daily) {
      rows.push([
        account.name,
        currency,
        entry.date,
        'account',
        '',
        '',
        entry.spend,
        entry.impressions,
        entry.reach,
        entry.clicks,
        '',
        '',
        '',
      ]);
    }

    for (const level of ['campaign', 'adset', 'ad'] as const) {
      for (const entry of await readCampaigns({ ...scope, level })) {
        rows.push([
          account.name,
          currency,
          '',
          level,
          entry.name,
          entry.campaignName ?? '',
          entry.spend,
          entry.impressions,
          entry.reach,
          entry.clicks,
          entry.cpc,
          entry.cpm,
          entry.ctr,
        ]);
      }
    }
  }

  return toCsv(
    [
      'ad_account',
      'currency',
      'date',
      'level',
      'name',
      'campaign',
      'spend',
      'impressions',
      'reach',
      'clicks',
      'cpc',
      'cpm',
      'ctr',
    ],
    rows,
  );
}

const BUILDERS: Record<ExportKind, (options: Window) => Promise<string>> = {
  posts: postMetricsCsv,
  page: pageInsightsCsv,
  external: externalPostsCsv,
  comments: commentsCsv,
  reviews: reviewsCsv,
  videos: videosCsv,
  instagram: instagramCsv,
  instagram_media: instagramMediaCsv,
  ads: adsCsv,
};

export const EXPORT_KINDS = Object.keys(BUILDERS) as ExportKind[];

export function buildExport(kind: ExportKind, options: Window): Promise<string> {
  return BUILDERS[kind](options);
}
