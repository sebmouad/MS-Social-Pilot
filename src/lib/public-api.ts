import { TargetType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from './prisma';
import { createPost } from './posts';
import { createPostSchema } from './validation';
import { assertPageParam, assertPagesAllowed, mayUsePage, postScope, targetScope } from './page-access';
import { analysePage } from './page-analysis-data';
import { postStatusFilter } from './constants';
import { parseMedia } from './json';
import { errors } from './errors';
import { assertApiModule, type ApiContext } from './api-tokens';

/**
 * What the public API and the MCP tools can do, written once.
 *
 * Plain data in and out, the same rules as the app: a key sees the Pages its
 * owner may see, and a post made here goes through the same approval and
 * queue rules as one written in the composer. Nothing publishes faster or
 * with fewer checks for having come in by key.
 */

export async function apiListPages(ctx: ApiContext) {
  const pages = await prisma.target.findMany({
    where: { workspaceId: ctx.workspace.id, type: TargetType.page, ...targetScope(ctx.pageScope) },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, category: true, followersCount: true, fanCount: true, enabled: true, canPublish: true },
  });
  return pages.map((page) => ({
    id: page.id,
    name: page.name,
    category: page.category,
    followers: page.followersCount ?? page.fanCount,
    canPublish: page.enabled && page.canPublish,
  }));
}

export const listPostsSchema = z.object({
  status: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Comma-separated Page ids, like the app's selection; ids the key may not see are dropped. */
  pages: z.string().max(4000).optional(),
});

export async function apiListPosts(ctx: ApiContext, raw: unknown) {
  assertApiModule(ctx, 'schedule');
  const query = listPostsSchema.parse(raw);
  const statuses = postStatusFilter(query.status);
  const pages = query.pages
    ?.split(',')
    .map((id) => id.trim())
    .filter((id) => id && mayUsePage(ctx.pageScope, id));
  const posts = await prisma.post.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      ...postScope(pages ? { all: false, ids: pages } : ctx.pageScope),
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(query.from || query.to ? { scheduledAt: { gte: query.from, lte: query.to } } : {}),
    },
    include: { targets: { include: { target: { select: { id: true, name: true } } } } },
    orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    take: query.limit,
  });
  return posts.map((post) => ({
    id: post.id,
    status: post.status,
    format: post.format,
    message: post.message,
    link: post.link,
    media: parseMedia(post.media).map((item) => ({ kind: item.kind, url: 'url' in item ? item.url : null })),
    scheduledAt: post.scheduledAt,
    publishedAt: post.publishedAt,
    pages: post.targets.map((row) => ({ id: row.target.id, name: row.target.name, status: row.status, url: row.remoteUrl })),
  }));
}

export async function apiCreatePost(ctx: ApiContext, raw: unknown) {
  assertApiModule(ctx, 'schedule');
  const input = createPostSchema.parse(raw);
  assertPagesAllowed(ctx.pageScope, input.targetIds);
  return createPost(
    { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role, requiresApproval: ctx.workspace.requiresApproval },
    { ...input, timezone: input.timezone === 'UTC' ? ctx.workspace.timezone : input.timezone },
  );
}

export const pageAnalyticsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/** The analysis screen's headline answer for one Page, as data. */
export async function apiPageAnalytics(ctx: ApiContext, targetId: string, raw: unknown) {
  assertApiModule(ctx, 'analytics');
  assertPageParam(ctx.pageScope, targetId);
  const { days } = pageAnalyticsSchema.parse(raw);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const analysis = await analysePage({
    workspaceId: ctx.workspace.id,
    targetId,
    from,
    to,
    timeZone: ctx.workspace.timezone,
  }).catch(() => {
    throw errors.notFound();
  });
  return {
    page: { id: analysis.page.id, name: analysis.page.name, followers: analysis.page.followers },
    window: { from, to, days },
    health: { score: analysis.health.score, band: analysis.health.band },
    kpis: analysis.kpis.map((kpi) => ({ key: kpi.key, current: kpi.current, previous: kpi.previous, changePercent: kpi.change })),
    bestTimes: analysis.times.best.slice(0, 3),
    topPosts: analysis.top.slice(0, 5).map((post) => ({
      message: post.message.slice(0, 280),
      url: post.url,
      publishedAt: post.publishedAt,
      reach: post.reach,
      interactions: post.reactions + post.comments + post.shares,
    })),
    findings: analysis.findings.map((finding) => ({ tone: finding.tone, key: finding.key, params: finding.params })),
  };
}
