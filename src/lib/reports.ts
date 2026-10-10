import { PostTargetStatus } from '@prisma/client';

import { prisma } from './prisma';
import { parseInsights, parseMedia, type PostInsights } from './json';
import { DEFAULT_TIMEZONE, firstRealInstant, formatInZone, isValidTimeZone } from './time';
import { toCsv } from './csv';
import { feedLinkOf, feedMediaOf } from './feed';
import type { FeedLinkPreview, FeedMedia } from '@/components/FeedPost';
import { AppError, errors } from './errors';

/**
 * Reporting.
 *
 * Numbers come from two places and are labelled as such: Facebook's own
 * insights (impressions, reach, engagement) and our short-link click counts.
 * They are never added together — they measure different things, and a total
 * that mixes them would be meaningless.
 */

export interface DestinationRow {
  targetId: string;
  name: string;
  type: string;
  posts: number;
  impressions: number;
  reach: number;
  reactions: number;
  comments: number;
  shares: number;
  clicks: number;
}

/**
 * One post, however many destinations it went to.
 *
 * Ranked per destination row, a post sent to three Pages took three of the ten
 * places — and a client with one strong post saw it listed three times over
 * the posts that came next.
 */
export interface TopPost {
  postId: string;
  message: string;
  /** When it first went out in the range. */
  publishedLabel: string | null;
  /** Every destination it reached in the range, each with its link there. */
  destinations: Array<{ name: string; url: string | null; pictureUrl?: string | null }>;
  /** Its first picture and its link, to draw it as the feed does. */
  imageUrl?: string | null;
  link?: string | null;
  media?: FeedMedia[];
  linkPreview?: FeedLinkPreview | null;
  /** Summed across those destinations. */
  engagement: number;
  impressions: number;
}

export interface Report {
  from: Date;
  to: Date;
  postsPublished: number;
  totals: {
    impressions: number;
    reach: number;
    engagement: number;
    /**
     * Every click the range's posts' short links have ever had — not clicks
     * made in the range. The per-click rows that carry a date are pruned after
     * `retention.clickDays`, so counting by date would quietly undercount any
     * range older than that; the running total is the figure that stays true,
     * and it is labelled as lifetime wherever it is shown.
     */
    linkClicks: number;
  };
  destinations: DestinationRow[];
  topPosts: TopPost[];
}

function number(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function engagementOf(insights: PostInsights | null): number {
  if (!insights) return 0;
  return number(insights.reactions) + number(insights.comments) + number(insights.shares);
}

/** A resolved date range, or the reason it could not be. */
export type RangeResult =
  | { ok: true; from: Date; to: Date }
  | {
      ok: false;
      /** Carries the translation key; routes throw it, the screen translates it. */
      error: AppError;
      /** The English fallback, for logs and tests. */
      message: string;
    };

function refuse(error: AppError): RangeResult {
  return { ok: false, error, message: error.message };
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** A bare calendar day, as an `<input type="date">` submits it. */
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day after this one, by calendar arithmetic rather than +24h. */
function dayAfter(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * Work out which period a report covers.
 *
 * Shared by the report screen and the two CSV routes, which asked the same
 * question three ways and disagreed with each other.
 *
 * **A day means a day where the client is.** The dates come from a date
 * picker, so "1 August" is a day on the workspace's calendar, not the instant
 * midnight UTC. Reading them as UTC moved the boundary by the offset: a Los
 * Angeles workspace asking for August got seven hours of 31 July at one end
 * and lost the last seven hours of 31 August at the other — and the date field
 * redisplayed their "1 August" as "31 July", which is the version they could
 * actually see.
 *
 * The end of the range is the last instant of its final day, taken as the
 * start of the day after minus a millisecond. Writing `23:59:59` instead would
 * drop anything published in the final second, and would land in the wrong
 * place in a zone that changes its clocks at midnight.
 *
 * An inverted range is refused rather than run. It returns nothing, and a
 * report of nothing is indistinguishable from a month in which the client's
 * pages were silent — so a typo in the dates reads as bad news about their
 * account instead of a typo.
 */
export function parseReportRange(params: {
  from: string | null;
  to: string | null;
  timeZone?: string;
  now?: Date;
}): RangeResult {
  const zone = params.timeZone && isValidTimeZone(params.timeZone) ? params.timeZone : DEFAULT_TIMEZONE;

  const startOfDay = (day: string) => firstRealInstant(`${day}T00:00`, zone);
  const endOfDay = (day: string) => new Date(startOfDay(dayAfter(day)).getTime() - 1);

  const to = params.to
    ? BARE_DAY.test(params.to)
      ? endOfDay(params.to)
      : new Date(params.to)
    : (params.now ?? new Date());

  // Last 30 days by default: long enough to be meaningful, short enough to
  // load quickly.
  const from = params.from
    ? BARE_DAY.test(params.from)
      ? startOfDay(params.from)
      : new Date(params.from)
    : new Date(to.getTime() - THIRTY_DAYS_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return refuse(errors.dateRange());
  }

  if (from.getTime() > to.getTime()) {
    return refuse(errors.dateRangeInverted());
  }

  return { ok: true, from, to };
}

/**
 * Name a downloaded CSV after the period it covers, not just its last day.
 *
 * Stamping only the end date gives the same name to every range ending today,
 * so a client sent last month and last quarter receives two files called the
 * same thing — and the browser quietly renames the second rather than saying
 * so. Nothing inside the file records the range either.
 *
 * The days are the workspace's, like the range itself. Taken in UTC, a Los
 * Angeles report for August — which ends at 23:59 on 31 August local, 06:59
 * on 1 September UTC — was saved as `…_2026-09-01.csv`, naming a day the
 * report does not cover.
 */
export function csvFilename(
  prefix: string,
  slug: string,
  range: { from: Date; to: Date },
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  // No locale: these are digits, and a filename should not change language.
  const day = (date: Date) => formatInZone(date, zone, 'yyyy-MM-dd', undefined);
  return `${prefix}-${slug}-${day(range.from)}_${day(range.to)}.csv`;
}

/**
 * Split one post's clicks across the destinations it went to.
 *
 * A short link is shared by every destination, so there is no way to know
 * which of them earned a click — the split is a presentational convenience,
 * not a measurement. What matters is that it adds up: this is a report a
 * client reads, and a destination column that does not sum to the total beside
 * it costs more credibility than the rounding ever bought.
 *
 * Rounding each equal share independently fails both ways. Five clicks across
 * two destinations rounds to three each and claims six clicks that never
 * happened; ten across three rounds to three each and loses one. So the
 * remainder is handed out a click at a time instead, to the first destinations
 * in order — arbitrary, but exact.
 */
export function spreadClicks(total: number, parts: number): number[] {
  if (parts <= 0) return [];

  const base = Math.floor(total / parts);
  const remainder = total - base * parts;

  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

export async function buildReport(options: {
  workspaceId: string;
  timezone: string;
  from: Date;
  to: Date;
}): Promise<Report> {
  const published = await prisma.postTarget.findMany({
    where: {
      status: PostTargetStatus.published,
      publishedAt: { gte: options.from, lte: options.to },
      post: { workspaceId: options.workspaceId },
    },
    include: {
      target: { select: { id: true, name: true, type: true, pictureUrl: true } },
      post: { select: { id: true, message: true, media: true, link: true, linkPreview: true } },
    },
    orderBy: { publishedAt: 'desc' },
  });

  // Clicks are attributed to the post, not the destination: one short link is
  // shared by every destination the post went to.
  const clicksByPost = new Map<string, number>();
  const shortLinks = await prisma.shortLink.findMany({
    where: {
      workspaceId: options.workspaceId,
      postId: { in: [...new Set(published.map((row) => row.post.id))] },
    },
    select: { postId: true, clickCount: true },
  });
  for (const link of shortLinks) {
    if (!link.postId) continue;
    clicksByPost.set(link.postId, (clicksByPost.get(link.postId) ?? 0) + link.clickCount);
  }

  const byDestination = new Map<string, DestinationRow>();
  const totals = { impressions: 0, reach: 0, engagement: 0, linkClicks: 0 };
  const deliveries: PostDelivery[] = [];

  for (const row of published) {
    const insights = parseInsights(row.insights);
    const engagement = engagementOf(insights);

    const existing = byDestination.get(row.target.id) ?? {
      targetId: row.target.id,
      name: row.target.name,
      type: row.target.type,
      posts: 0,
      impressions: 0,
      reach: 0,
      reactions: 0,
      comments: 0,
      shares: 0,
      clicks: 0,
    };

    existing.posts += 1;
    existing.impressions += number(insights?.impressions);
    existing.reach += number(insights?.reach);
    existing.reactions += number(insights?.reactions);
    existing.comments += number(insights?.comments);
    existing.shares += number(insights?.shares);
    byDestination.set(row.target.id, existing);

    totals.impressions += number(insights?.impressions);
    totals.reach += number(insights?.reach);
    totals.engagement += engagement;

    deliveries.push({
      postId: row.post.id,
      message: row.post.message,
      publishedAt: row.publishedAt,
      targetName: row.target.name,
      targetPictureUrl: row.target.pictureUrl,
      url: row.remoteUrl,
      imageUrl: parseMedia(row.post.media).find((item) => item.kind === 'image')?.url ?? null,
      link: row.post.link,
      media: feedMediaOf(row.post.media),
      linkPreview: feedLinkOf(row.post.linkPreview),
      engagement,
      impressions: number(insights?.impressions),
    });
  }

  // Each post's clicks counted once, then spread across its destinations for
  // the per-destination table.
  for (const [postId, clicks] of clicksByPost) {
    totals.linkClicks += clicks;
    const destinations = published.filter((row) => row.post.id === postId);
    const shares = spreadClicks(clicks, destinations.length);
    destinations.forEach((row, index) => {
      const entry = byDestination.get(row.target.id);
      if (entry) entry.clicks += shares[index] ?? 0;
    });
  }

  return {
    from: options.from,
    to: options.to,
    postsPublished: new Set(published.map((row) => row.post.id)).size,
    totals,
    destinations: [...byDestination.values()].sort((a, b) => b.impressions - a.impressions),
    topPosts: rankTopPosts(deliveries, options.timezone),
  };
}

/** One published destination row, as `rankTopPosts` reads it. */
export interface PostDelivery {
  postId: string;
  message: string;
  publishedAt: Date | null;
  targetName: string;
  targetPictureUrl?: string | null;
  url: string | null;
  imageUrl?: string | null;
  link?: string | null;
  media?: FeedMedia[];
  linkPreview?: FeedLinkPreview | null;
  engagement: number;
  impressions: number;
}

/**
 * The best posts of the range, one entry per post rather than per destination.
 *
 * Each post's destinations are summed before ranking, so a post that went to
 * three Pages competes once, on what it earned across all three.
 */
export function rankTopPosts(deliveries: PostDelivery[], timezone: string, limit = 10): TopPost[] {
  const byPost = new Map<string, TopPost & { firstPublished: Date | null }>();

  for (const row of deliveries) {
    const post = byPost.get(row.postId) ?? {
      postId: row.postId,
      message: row.message,
      publishedLabel: null,
      firstPublished: null,
      destinations: [],
      engagement: 0,
      impressions: 0,
      ...(row.imageUrl !== undefined ? { imageUrl: row.imageUrl } : {}),
      ...(row.link !== undefined ? { link: row.link } : {}),
      ...(row.media !== undefined ? { media: row.media } : {}),
      ...(row.linkPreview !== undefined ? { linkPreview: row.linkPreview } : {}),
    };
    post.destinations.push({
      name: row.targetName,
      url: row.url,
      ...(row.targetPictureUrl !== undefined ? { pictureUrl: row.targetPictureUrl } : {}),
    });
    post.engagement += row.engagement;
    post.impressions += row.impressions;
    if (row.publishedAt && (!post.firstPublished || row.publishedAt < post.firstPublished)) {
      post.firstPublished = row.publishedAt;
    }
    byPost.set(row.postId, post);
  }

  return [...byPost.values()]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, limit)
    .map(({ firstPublished, ...post }) => ({
      ...post,
      publishedLabel: firstPublished ? formatInZone(firstPublished, timezone) : null,
    }));
}

/** CSV of the per-destination table, for a spreadsheet or a client deck. */
export function reportToCsv(report: Report): string {
  const rows = [
    // Lifetime, like the screen says: see `Report.totals.linkClicks`.
    ['destination', 'type', 'posts', 'impressions', 'reach', 'reactions', 'comments', 'shares', 'link_clicks_lifetime'],
    ...report.destinations.map((row) => [
      row.name,
      row.type,
      row.posts,
      row.impressions,
      row.reach,
      row.reactions,
      row.comments,
      row.shares,
      row.clicks,
    ]),
  ];

  // Shared with the analytics exports: a destination name comes from Facebook,
  // so it gets the same treatment as any other text that is not ours.
  return toCsv(rows);
}
