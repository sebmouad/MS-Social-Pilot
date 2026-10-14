import { PrismaClient } from "../../generated/client";

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
export function getTargets(workspaceId: string) {
  return prisma.target.findMany({
    where: { workspaceId, enabled: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: {
      id: true,
      type: true,
      providerId: true,
      name: true,
      pictureUrl: true,
      canPublish: true,
      socialAccount: {
        select: { id: true, provider: true, name: true, pictureUrl: true, invalidatedAt: true },
      },
    },
  });
}

/** Return posts and their destinations, newest activity first. */
export async function listPosts(workspaceId: string, limit = 100): Promise<PostSummary[]> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  const posts = await prisma.post.findMany({
    where: { workspaceId },
    orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    take: safeLimit,
    select: {
      id: true,
      message: true,
      status: true,
      scheduledAt: true,
      publishedAt: true,
      createdAt: true,
      targets: {
        select: {
          status: true,
          remotePostId: true,
          remoteUrl: true,
          target: { select: { id: true, type: true, name: true, pictureUrl: true } },
        },
      },
    },
  });
  return posts;
}

/** Read the basic workspace details used by the new app shell. */
export function workspaceSummary(workspaceId: string) {
  return prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true, timezone: true },
  });
}

export function listConnections(workspaceId: string) {
  return prisma.socialAccount.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      provider: true,
      name: true,
      pictureUrl: true,
      invalidatedAt: true,
      createdAt: true,
      targets: { select: { id: true, type: true, name: true, enabled: true } },
      adAccounts: { select: { id: true, actId: true, name: true, enabled: true } },
    },
  });
}

/** Read linked advertising account metadata. */
export function getAdAccounts(workspaceId: string) {
  return prisma.adAccount.findMany({
    where: { workspaceId },
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
