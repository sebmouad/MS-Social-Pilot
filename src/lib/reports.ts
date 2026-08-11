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
    const share = destinations.length > 0 ? clicks / destinations.length : 0;
    for (const row of destinations) {
      const entry = byDestination.get(row.target.id);
      if (entry) entry.clicks += Math.round(share);
    }
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
