import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/data';

export type DataControlActor = { userId: string; workspaceId: string };
const MANAGER_ROLES = new Set(['owner', 'admin']);

async function assertManager(actor: DataControlActor) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    select: { role: true },
  });
  if (!membership) throw new Error('You are no longer a member of this workspace.');
  if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can manage workspace data.');
}

/** Export workspace content and operational history while stripping provider credentials. */
export async function exportWorkspaceData(actor: DataControlActor) {
  await assertManager(actor);
  const workspace = await prisma.workspace.findUnique({ where: { id: actor.workspaceId } });
  if (!workspace) throw new Error('This workspace is unavailable.');
  const [memberships, socialAccounts, targets, adAccounts, posts] = await Promise.all([
    prisma.membership.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } } }),
    prisma.socialAccount.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true, provider: true, providerUserId: true, name: true, pictureUrl: true, tokenExpiresAt: true, scopes: true, invalidatedAt: true, invalidReason: true, createdAt: true, updatedAt: true } }),
    prisma.target.findMany({ where: { workspaceId: actor.workspaceId }, include: { insights: true, conversations: { include: { messages: true } }, postTargets: { include: { comments: true, post: { select: { id: true, message: true, firstComment: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true, updatedAt: true } } } } } }),
    prisma.adAccount.findMany({ where: { workspaceId: actor.workspaceId }, include: { insights: true } }),
    prisma.post.findMany({ where: { workspaceId: actor.workspaceId }, include: { targets: { include: { comments: true, target: { select: { id: true, type: true, providerId: true, name: true } } } } } }),
  ]);
  return {
    format: 'ms-social-pilot-workspace-export', version: 1, exportedAt: new Date().toISOString(),
    workspace, memberships,
    socialAccounts: socialAccounts.map(account => ({
      id: account.id, provider: account.provider, providerUserId: account.providerUserId,
      name: account.name, pictureUrl: account.pictureUrl, tokenExpiresAt: account.tokenExpiresAt,
      scopes: account.scopes, invalidatedAt: account.invalidatedAt, invalidReason: account.invalidReason,
      createdAt: account.createdAt, updatedAt: account.updatedAt,
    })),
    targets: targets.map(({ accessToken: _token, ...target }) => target),
    adAccounts, posts,
    security: { credentialsExcluded: true, auditLogExcluded: true, note: 'Provider access tokens and instance-wide audit records are excluded.' },
  };
}

/** Erase all workspace-owned content in one database transaction. Workspace identity and memberships remain. */
export async function deleteWorkspaceData(actor: DataControlActor, confirmation: string) {
  if (confirmation !== 'DELETE') throw new Error('Type DELETE to confirm this action.');
  return prisma.$transaction(async tx => {
    const membership = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
    if (!membership) throw new Error('You are no longer a member of this workspace.');
    if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can manage workspace data.');
    const workspace = await tx.workspace.findUnique({ where: { id: actor.workspaceId }, select: { id: true } });
    if (!workspace) throw new Error('This workspace is unavailable.');

    const targetRows = await tx.target.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true } });
    const targetIds = targetRows.map(row => row.id);
    const adRows = await tx.adAccount.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true } });
    const adAccountIds = adRows.map(row => row.id);
    const workspacePostRows = await tx.post.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true } });
    const workspacePostIds = workspacePostRows.map(row => row.id);
    const postTargetRows = workspacePostIds.length ? await tx.postTarget.findMany({ where: { postId: { in: workspacePostIds } }, select: { id: true, postId: true } }) : [];
    const postTargetIds = postTargetRows.map(row => row.id);
    const conversationRows = targetIds.length ? await tx.conversation.findMany({ where: { targetId: { in: targetIds } }, select: { id: true } }) : [];
    const conversationIds = conversationRows.map(row => row.id);
    const comments = postTargetIds.length ? await tx.postComment.deleteMany({ where: { postTargetId: { in: postTargetIds } } }) : { count: 0 };
    if (postTargetIds.length) await tx.postTarget.deleteMany({ where: { id: { in: postTargetIds } } });
    if (conversationIds.length) await tx.conversationMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
    const conversations = conversationIds.length ? await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } }) : { count: 0 };
    const pageInsights = targetIds.length ? await tx.pageInsight.deleteMany({ where: { targetId: { in: targetIds } } }) : { count: 0 };
    const adInsights = adAccountIds.length ? await tx.adInsight.deleteMany({ where: { adAccountId: { in: adAccountIds } } }) : { count: 0 };
    const posts = await tx.post.deleteMany({ where: { workspaceId: actor.workspaceId } });
    const targets = await tx.target.deleteMany({ where: { workspaceId: actor.workspaceId } });
    const adAccounts = await tx.adAccount.deleteMany({ where: { workspaceId: actor.workspaceId } });
    const socialAccounts = await tx.socialAccount.deleteMany({ where: { workspaceId: actor.workspaceId } });

    const counts = { posts: posts.count, postTargets: postTargetRows.length, comments: comments.count, targets: targets.count, conversations: conversations.count, pageInsights: pageInsights.count, adAccounts: adAccounts.count, adInsights: adInsights.count, socialAccounts: socialAccounts.count };
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`data_${randomBytes(12).toString('hex')}`}, ${actor.userId}, 'workspace.data_deleted', ${JSON.stringify({ workspaceId: actor.workspaceId, counts })}::jsonb, NOW())`;
    return counts;
  });
}
