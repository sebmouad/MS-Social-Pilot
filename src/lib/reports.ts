import { PostTargetStatus } from '@prisma/client';

import { prisma } from './prisma';
import { parseInsights, type PostInsights } from './json';
import { formatInZone } from './time';
import { toCsv } from './csv';

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

export interface TopPost {
  postId: string;
  message: string;
  publishedLabel: string | null;
  url: string | null;
  targetName: string;
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
  | { ok: false; message: string };

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Work out which period a report covers.
 *
 * Shared by the report and the analytics exports, which asked the same
 * question in the same way and got the same two things wrong.
 *
 * An inverted range is refused rather than run. It returns nothing, and a
 * report of nothing is indistinguishable from a month in which the client's
 * pages were silent — so a typo in the dates reads as bad news about their
 * account instead of a typo.
 */
export function parseReportRange(params: {
  from: string | null;
  to: string | null;
  now?: Date;
}): RangeResult {
  const to = params.to ? new Date(params.to) : (params.now ?? new Date());
  // Last 30 days by default: long enough to be meaningful, short enough to
  // load quickly.
  const from = params.from ? new Date(params.from) : new Date(to.getTime() - THIRTY_DAYS_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, message: 'Enter a valid date range.' };
  }

  if (from.getTime() > to.getTime()) {
    return { ok: false, message: 'The start of the range comes after its end. Swap the dates.' };
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
 */
export function csvFilename(prefix: string, slug: string, range: { from: Date; to: Date }): string {
  const day = (date: Date) => date.toISOString().slice(0, 10);
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
      target: { select: { id: true, name: true, type: true } },
      post: { select: { id: true, message: true } },
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
  const topPosts: TopPost[] = [];

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

    topPosts.push({
      postId: row.post.id,
      message: row.post.message,
      publishedLabel: row.publishedAt ? formatInZone(row.publishedAt, options.timezone) : null,
      url: row.remoteUrl,
      targetName: row.target.name,
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
    topPosts: topPosts.sort((a, b) => b.engagement - a.engagement).slice(0, 10),
  };
}

/** CSV of the per-destination table, for a spreadsheet or a client deck. */
export function reportToCsv(report: Report): string {
  const rows = [
    ['destination', 'type', 'posts', 'impressions', 'reach', 'reactions', 'comments', 'shares', 'link_clicks'],
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
