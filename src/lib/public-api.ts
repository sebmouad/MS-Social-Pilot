import { TargetType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from './prisma';
import { cancelPost, createPost, updatePost } from './posts';
import { approvePost, rejectPost } from './approvals';
import { countOpenInbox, readInbox, setInboxAssignee, setInboxResolved, type InboxAssignee } from './inbox';
import { summariseConnections } from './connections';
import { assertPostInScope, postTargetScope } from './page-access';
import { createPostSchema, updatePostSchema } from './validation';
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

const postContext = (ctx: ApiContext) => ({
  workspaceId: ctx.workspace.id,
  userId: ctx.user.id,
  role: ctx.role,
  requiresApproval: ctx.workspace.requiresApproval,
});

/** Change a post: text, time, destinations, or back to draft. Same rules as the editor. */
export async function apiUpdatePost(ctx: ApiContext, postId: string, raw: unknown) {
  assertApiModule(ctx, 'schedule');
  const input = updatePostSchema.parse(raw);
  await assertPostInScope(ctx.pageScope, ctx.workspace.id, postId);
  if (input.targetIds) assertPagesAllowed(ctx.pageScope, input.targetIds);
  await updatePost(postContext(ctx), postId, { ...input, timezone: input.timezone ?? ctx.workspace.timezone });
  return { ok: true };
}

/** Cancel a post; copies already handed to Facebook are removed there too. */
export async function apiCancelPost(ctx: ApiContext, postId: string) {
  assertApiModule(ctx, 'schedule');
  await assertPostInScope(ctx.pageScope, ctx.workspace.id, postId);
  return cancelPost({ workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role }, postId);
}

export async function apiApprovePost(ctx: ApiContext, postId: string) {
  assertApiModule(ctx, 'schedule');
  await assertPostInScope(ctx.pageScope, ctx.workspace.id, postId);
  await approvePost({ workspaceId: ctx.workspace.id, postId, reviewerId: ctx.user.id, reviewerRole: ctx.role });
  return { ok: true };
}

export async function apiRejectPost(ctx: ApiContext, postId: string, note: string) {
  assertApiModule(ctx, 'schedule');
  await assertPostInScope(ctx.pageScope, ctx.workspace.id, postId);
  await rejectPost({ workspaceId: ctx.workspace.id, postId, reviewerId: ctx.user.id, reviewerRole: ctx.role, note });
  return { ok: true };
}

const inboxSchema = z.object({
  kind: z.enum(['comment', 'message']).optional(),
  state: z.enum(['open', 'resolved', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  assignee: z.enum(['mine', 'unassigned']).optional(),
});

async function inboxTargetIds(ctx: ApiContext): Promise<string[]> {
  const rows = await prisma.target.findMany({ where: { workspaceId: ctx.workspace.id, ...targetScope(ctx.pageScope) }, select: { id: true } });
  return rows.map((row) => row.id);
}

/** What people wrote to the key's Pages, newest first. */
export async function apiReadInbox(ctx: ApiContext, raw: unknown) {
  assertApiModule(ctx, 'analytics');
  const query = inboxSchema.parse(raw);
  const { assignee: who, ...rest } = query;
  const assignee: InboxAssignee | undefined =
    who === 'mine' ? { kind: 'member', userId: ctx.user.id } : who === 'unassigned' ? { kind: 'unassigned' } : undefined;
  const items = await readInbox({ workspaceId: ctx.workspace.id, targetIds: await inboxTargetIds(ctx), ...rest, assignee });
  return items.map((item) => ({
    kind: item.kind,
    id: item.id,
    page: item.targetName,
    author: item.author,
    text: item.text,
    at: item.at,
    onPost: item.postMessage,
    done: item.resolvedAt !== null,
    assigneeId: item.assigneeId,
  }));
}

export async function apiAssignInbox(ctx: ApiContext, raw: unknown) {
  assertApiModule(ctx, 'analytics');
  const input = z.object({ kind: z.enum(['comment', 'message']), id: z.string().min(1), assigneeId: z.string().min(1).nullable() }).parse(raw);
  const found = await setInboxAssignee({ workspaceId: ctx.workspace.id, targetIds: await inboxTargetIds(ctx), ...input });
  if (!found) throw errors.notFound();
  return { ok: true };
}

export async function apiResolveInbox(ctx: ApiContext, raw: unknown) {
  assertApiModule(ctx, 'analytics');
  const input = z.object({ kind: z.enum(['comment', 'message']), id: z.string().min(1), resolved: z.boolean().default(true) }).parse(raw);
  const found = await setInboxResolved({ workspaceId: ctx.workspace.id, targetIds: await inboxTargetIds(ctx), ...input });
  if (!found) throw errors.notFound();
  return { ok: true };
}

/** Everything waiting on somebody, in one answer: failures, reviews, replies, connections. */
export async function apiAttention(ctx: ApiContext) {
  const workspaceId = ctx.workspace.id;
  const [failedPosts, awaitingApproval, inbox, connections] = await Promise.all([
    prisma.postTarget.count({ where: { status: 'failed', post: { workspaceId }, ...postTargetScope(ctx.pageScope) } }),
    prisma.post.count({ where: { workspaceId, status: 'pending_approval', ...postScope(ctx.pageScope) } }),
    countOpenInbox({ workspaceId, targetIds: await inboxTargetIds(ctx) }),
    summariseConnections(workspaceId),
  ]);
  return {
    failedPosts,
    awaitingApproval,
    openComments: inbox.comments,
    openMessages: inbox.messages,
    disconnectedAccounts: connections.broken,
    tokensExpiringSoon: connections.expiring,
  };
}

/** The posting times in the queue: the ones every channel shares and each channel's own. */
export async function apiListQueue(ctx: ApiContext) {
  assertApiModule(ctx, 'schedule');
  const slots = await prisma.queueSlot.findMany({
    where: { workspaceId: ctx.workspace.id, OR: [{ targetId: null }, { target: targetScope(ctx.pageScope) }] },
    include: { target: { select: { name: true } } },
    orderBy: [{ dayOfWeek: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
  });
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return slots.map((slot) => ({
    day: days[slot.dayOfWeek],
    time: `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`,
    channel: slot.target?.name ?? null,
  }));
}

/** Post templates, to start a post from. */
export async function apiListTemplates(ctx: ApiContext) {
  assertApiModule(ctx, 'schedule');
  const templates = await prisma.postTemplate.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: { id: true, name: true, category: true, body: true, hashtags: true, firstComment: true },
    orderBy: { name: 'asc' },
  });
  return templates;
}
