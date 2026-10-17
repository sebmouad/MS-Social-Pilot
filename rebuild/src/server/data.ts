import { PrismaClient, type Prisma, type PostStatus } from "../../generated/client";
import { selectedResourceConnectionWhere } from './platforms/resource-visibility';
import { enabledSocialAccountWhere } from './platforms/registry';
import { FIRST_COMMENT_REJECTED } from '@/modules/publishing/first-comment-state';
import { publishingPostVisibilityWhere } from '@/modules/publishing/server/read-scope';

/** Legacy error strings can contain provider details; never serialize them to clients. */
function safeCommentErrors<T extends { targets: Array<{ firstCommentError: string | null }> }>(posts: T[]): T[] {
  return posts.map(post => ({ ...post, targets: post.targets.map(row => ({ ...row, firstCommentError: row.firstCommentError === FIRST_COMMENT_REJECTED ? FIRST_COMMENT_REJECTED : row.firstCommentError ? 'review_required' : null })) }));
}

const globalForPrisma = globalThis as typeof globalThis & {
  rebuildPrisma?: PrismaClient;
};

/** Shared client for read access to the existing app database. */
export const prisma =
  globalForPrisma.rebuildPrisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.rebuildPrisma = prisma;

export type WorkspaceSummary = {
  membershipId: string;
  role: string;
  workspace: { id: string; name: string; slug: string; timezone: string };
};

export type PostSummary = {
  id: string;
  message: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  targets: Array<{
    status: string;
    remotePostId: string | null;
    remoteUrl: string | null;
    target: { id: string; type: string; name: string; pictureUrl: string | null };
  }>;
};

/** Read the existing password hash and account-disable state for sign-in. */
export function getUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, passwordHash: true, disabledAt: true },
  });
}


/** Validate a legacy session by its hash and expiry; pending sessions are exposed to the caller. */
export function getSessionByTokenHash(tokenHash: string) {
  return prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      tokenHash: true,
      expiresAt: true,
      pending: true,
      user: { select: { id: true, disabledAt: true } },
    },
  });
}

/** Return the workspaces a user belongs to, with their existing role. */
export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    orderBy: { workspace: { name: "asc" } },
    select: {
      id: true,
      role: true,
      workspace: { select: { id: true, name: true, slug: true, timezone: true } },
    },
  });
  return memberships.map(({ id, role, workspace }) => ({ membershipId: id, role, workspace }));
}

/** Return connected destinations for a workspace without exposing access tokens. */
export async function getTargets(workspaceId: string, allowedTargetIds?: readonly string[], allowedProviders?: readonly string[]) {
  return prisma.target.findMany({
    where: { workspaceId, enabled: true, socialAccount: { is: await selectedResourceConnectionWhere(workspaceId, allowedProviders) }, ...(allowedTargetIds === undefined ? {} : { id: { in: [...allowedTargetIds] } }) },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: {
      id: true,
      type: true,
      providerId: true,
      name: true,
      pictureUrl: true,
      canPublish: true,
      socialAccount: {
        select: { id: true, provider: true, name: true, pictureUrl: true, invalidatedAt: true, tokenExpiresAt: true },
      },
    },
  });
}

/** Paginate posts after workspace and channel scope have been enforced in the query. */
export async function listPostPage(workspaceId: string, page: number, pageSize: number, allowedTargetIds: readonly string[] | null, authorId: string | undefined, filters: { status?: PostStatus; channelId?: string; order?: 'scheduled_asc' | 'created_asc'; where?: Prisma.PostWhereInput } = {}) {
  const size = Math.max(1, Math.min(Math.trunc(pageSize), 100));
  const requestedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const scopeWhere = publishingPostVisibilityWhere(workspaceId, allowedTargetIds, authorId);
  const where: Prisma.PostWhereInput = filters.where ? { AND: [scopeWhere, filters.where] } : {
    ...scopeWhere,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.channelId ? { targets: { some: { targetId: filters.channelId } } } : {}),
  };
  const total = await prisma.post.count({ where });
  const pages = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(requestedPage, pages);
  const posts = await prisma.post.findMany({
    where,
    orderBy: filters.order === 'scheduled_asc' ? [{ scheduledAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
      : filters.order === 'created_asc' ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : [{ scheduledAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    skip: (currentPage - 1) * size,
    take: size,
    select: {
      id: true, message: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true,
      firstComment: true, authorId: true, link: true, media: true,
      targets: { select: { id: true, status: true, remotePostId: true, remoteUrl: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true, target: { select: { id: true, type: true, name: true, pictureUrl: true } } } },
    },
  });
  return { posts: safeCommentErrors(posts), total, page: currentPage, pages };
}

/**
 * Read posts whose scheduled or published time falls in [from, to), with their
 * channels and the channel provider, after workspace and channel scope are
 * applied in the query. Callers pad the range and group by workspace-local day.
 */
export async function listCalendarRange(workspaceId: string, from: Date, to: Date, allowedTargetIds: readonly string[] | null, authorId: string | undefined, filters: { channelId?: string; status?: PostStatus } = {}) {
  const posts = await prisma.post.findMany({
    where: { ...publishingPostVisibilityWhere(workspaceId, allowedTargetIds, authorId), AND: [
      { OR: [{ scheduledAt: { gte: from, lt: to } }, { publishedAt: { gte: from, lt: to } }] },
      ...(filters.channelId ? [{ targets: { some: { targetId: filters.channelId } } }] : []),
      ...(filters.status ? [{ status: filters.status }] : []),
    ] },
    orderBy: [{ scheduledAt: 'asc' }, { publishedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, message: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true, authorId: true,
      firstComment: true, link: true, media: true,
      targets: { select: { id: true, status: true, remotePostId: true, remoteUrl: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true, target: { select: { id: true, name: true, type: true, pictureUrl: true, socialAccount: { select: { provider: true } } } } } },
    },
  });
  return safeCommentErrors(posts);
}

/** Read the basic workspace details used by the new app shell. */
export function workspaceSummary(workspaceId: string) {
  return prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true, timezone: true },
  });
}

export async function listConnections(workspaceId: string, allowedProviders: readonly string[]) {
  return prisma.socialAccount.findMany({
    where: { workspaceId, ...await enabledSocialAccountWhere(allowedProviders) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      provider: true,
      name: true,
      pictureUrl: true,
      invalidatedAt: true,
      tokenExpiresAt: true,
      createdAt: true,
      targets: { select: { id: true, type: true, name: true, enabled: true } },
      adAccounts: { select: { id: true, actId: true, name: true, enabled: true } },
    },
  });
}

/** Read linked advertising account metadata. */
export async function getAdAccounts(workspaceId: string, allowedProviders: readonly string[]) {
  return prisma.adAccount.findMany({
    where: { workspaceId, socialAccount: { is: await enabledSocialAccountWhere(allowedProviders) } },
    orderBy: { name: "asc" },
    select: { id: true, actId: true, name: true, currency: true, accountStatus: true, enabled: true, lastSyncedAt: true, socialAccountId: true },
  });
}

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** Read captured daily Page metrics for destinations owned by this workspace. */
export async function getPageInsightRows(workspaceId: string, days = 30) {
  return prisma.pageInsight.findMany({
    where: { target: { workspaceId, type: "page" }, period: "day", endTime: { gte: daysAgo(days) } },
    orderBy: { endTime: "desc" },
    select: { id: true, metric: true, period: true, endTime: true, numeric: true, target: { select: { id: true, name: true } } },
  });
}

/** Latest stored follower stock for each selected Page, with the current name preferred. */
export async function getLatestPageAudience(workspaceId: string, targetIds: string[]) {
  return Promise.all(targetIds.map(async targetId => {
    const rows = await prisma.pageInsight.findMany({
      where: { targetId, target: { workspaceId, type: 'page' }, metric: { in: ['page_follows', 'page_fans'] }, numeric: { not: null } },
      orderBy: { endTime: 'desc' },
      take: 20,
      select: { metric: true, numeric: true, endTime: true, target: { select: { id: true, name: true } } },
    });
    const latest = rows[0];
    return latest ? { targetId, name: latest.target.name, audience: latest.numeric ?? 0, asOf: latest.endTime, metric: latest.metric } : null;
  })).then(rows => rows.filter((row): row is NonNullable<typeof row> => row !== null));
}

/** Read account-level delivery rows and campaign-level rows for a workspace. */
export async function getAdPerformance(workspaceId: string, days = 30) {
  const where = { adAccount: { workspaceId }, date: { gte: daysAgo(days) } };
  const [accountRows, campaignRows] = await Promise.all([
    prisma.adInsight.findMany({
      where: { ...where, level: "account" },
      orderBy: { date: "desc" },
      select: { id: true, objectId: true, date: true, spend: true, impressions: true, clicks: true, reach: true, adAccount: { select: { id: true, name: true, currency: true } } },
    }),
    prisma.adInsight.findMany({
      where: { ...where, level: "campaign" },
      orderBy: [{ objectName: "asc" }, { date: "desc" }],
      select: { id: true, objectId: true, objectName: true, date: true, spend: true, impressions: true, clicks: true, reach: true, adAccount: { select: { id: true, name: true, currency: true } } },
    }),
  ]);
  return { accountRows, campaignRows };
}
