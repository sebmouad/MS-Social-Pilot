import { prisma } from "./data";
import { randomBytes, randomUUID } from "node:crypto";
import { encryptSecret } from "@/server/secret-crypto";
import type { FacebookAdAccount, FacebookCurrentUser, FacebookPage } from "@/platforms/facebook/publishing";

const MANAGER_ROLES = new Set(["owner", "admin"]);
export type ConnectionMutationActor = { userId: string; workspaceId: string };

export type ConnectionSelection = { kind: 'target' | 'adAccount'; id: string; enabled: boolean };

/** Read-only estimate of the local rows removed by disconnect delete mode. */
export async function previewSocialAccountDeletion(actor: ConnectionMutationActor, socialAccountId: string) {
  const membership = await currentMembership(actor);
  if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can change connections.');
  const account = await prisma.socialAccount.findFirst({ where: { id: socialAccountId, workspaceId: actor.workspaceId }, select: { id: true, targets: { select: { id: true } }, adAccounts: { select: { id: true } } } });
  if (!account) throw new Error('This source is unavailable in the current workspace.');
  return countDisconnectRows(prisma, actor.workspaceId, account);
}

async function countDisconnectRows(tx: typeof prisma | import('../../generated/client').Prisma.TransactionClient, workspaceId: string, account: { id: string; targets: Array<{ id: string }>; adAccounts: Array<{ id: string }> }) {
  const targetIds = account.targets.map(item => item.id);
  const adAccountIds = account.adAccounts.map(item => item.id);
  const instagramAccounts = await linkedInstagramAccounts(tx, workspaceId, account.id, targetIds);
  const instagramAccountIds = instagramAccounts.map(item => item.id);
  const targetLinks = targetIds.length ? await tx.postTarget.findMany({ where: { targetId: { in: targetIds } }, select: { id: true, postId: true } }) : [];
  const postTargetIds = targetLinks.map(row => row.id);
  const affectedPostIds = [...new Set(targetLinks.map(row => row.postId))];
  const conversations = targetIds.length ? await tx.conversation.findMany({ where: { targetId: { in: targetIds } }, select: { id: true } }) : [];
  const conversationIds = conversations.map(row => row.id);
  const orphanPosts = affectedPostIds.length ? await tx.post.findMany({
    where: { id: { in: affectedPostIds }, workspaceId, targets: { every: { targetId: { in: targetIds } } } }, select: { id: true },
  }) : [];
  const [comments, conversationMessages, pageInsights, adInsights, scheduledRemote, instagramInsights, instagramMedia] = await Promise.all([
    postTargetIds.length ? tx.postComment.count({ where: { postTargetId: { in: postTargetIds } } }) : 0,
    conversationIds.length ? tx.conversationMessage.count({ where: { conversationId: { in: conversationIds } } }) : 0,
    targetIds.length ? tx.pageInsight.count({ where: { targetId: { in: targetIds } } }) : 0,
    adAccountIds.length ? tx.adInsight.count({ where: { adAccountId: { in: adAccountIds } } }) : 0,
    postTargetIds.length ? tx.postTarget.count({ where: { id: { in: postTargetIds }, status: 'scheduled_remote' } }) : 0,
    instagramAccountIds.length ? tx.instagramInsight.count({ where: { accountId: { in: instagramAccountIds } } }) : 0,
    instagramAccountIds.length ? tx.instagramMedia.count({ where: { accountId: { in: instagramAccountIds } } }) : 0,
  ]);
  return {
    channels: targetIds.length, adAccounts: adAccountIds.length, postTargets: targetLinks.length,
    orphanPosts: orphanPosts.length, comments, conversations: conversations.length,
    conversationMessages, pageInsights, adInsights, scheduledRemote,
    instagramAccounts: instagramAccountIds.length, instagramInsights, instagramMedia,
  };
}

function linkedInstagramAccounts(tx: typeof prisma | import('../../generated/client').Prisma.TransactionClient, workspaceId: string, socialAccountId: string, targetIds: string[]) {
  return tx.instagramAccount.findMany({ where: { workspaceId, OR: [{ socialAccountId }, ...(targetIds.length ? [{ socialAccountId: null, targetId: { in: targetIds } }] : [])] }, select: { id: true } });
}

/** Apply a confirmed set of channel and ad account choices atomically. */
export async function setConnectionSelections(actor: ConnectionMutationActor, items: ConnectionSelection[]) {
  const membership = await currentMembership(actor);
  if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can change connections.');
  if (items.length > 250 || new Set(items.map(item => `${item.kind}:${item.id}`)).size !== items.length) throw new Error('Invalid selection list.');
  await prisma.$transaction(async tx => {
    for (const item of items) {
      if (item.kind === 'target') {
        const target = await tx.target.findFirst({ where: { id: item.id, workspaceId: actor.workspaceId }, select: { id: true, type: true, providerId: true, socialAccountId: true } });
        if (!target) throw new Error('This channel is unavailable in the current workspace.');
        if (item.enabled) {
          if (!target.socialAccountId || !await tx.socialAccount.findFirst({ where: { id: target.socialAccountId, workspaceId: actor.workspaceId, invalidatedAt: null }, select: { id: true } })) throw new Error('Reconnect this source before selecting it.');
        }
        await tx.target.updateMany({ where: { id: target.id, workspaceId: actor.workspaceId }, data: { enabled: item.enabled } });
        if (target.type === 'instagram') await tx.instagramAccount.updateMany({ where: { workspaceId: actor.workspaceId, igUserId: target.providerId }, data: { enabled: item.enabled } });
      } else {
        const account = await tx.adAccount.findFirst({ where: { id: item.id, workspaceId: actor.workspaceId }, select: { id: true, socialAccountId: true } });
        if (!account) throw new Error('This advertising account is unavailable in the current workspace.');
        if (item.enabled) {
          if (!account.socialAccountId || !await tx.socialAccount.findFirst({ where: { id: account.socialAccountId, workspaceId: actor.workspaceId, invalidatedAt: null }, select: { id: true } })) throw new Error('Reconnect this source before selecting it.');
        }
        await tx.adAccount.updateMany({ where: { id: account.id, workspaceId: actor.workspaceId }, data: { enabled: item.enabled } });
      }
      await auditConnectionEvent(tx, actor, 'connection.selection_changed', { kind: item.kind, id: item.id, enabled: item.enabled });
    }
  });
}

async function currentMembership(actor: ConnectionMutationActor) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    select: { role: true },
  });
  if (!membership) throw new Error("You are no longer a member of this workspace.");
  return membership;
}


/** Locally disconnect a source while retaining its discovered records and history. */
export async function disconnectSocialAccount(actor: ConnectionMutationActor, socialAccountId: string, mode: 'retain' | 'delete' = 'retain', confirmation?: string) {
  return prisma.$transaction(async tx => {
    const membership = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
    if (!membership) throw new Error('You are no longer a member of this workspace.');
    if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can change connections.');
    if (mode === 'delete' && confirmation !== 'DELETE') throw new Error('Type DELETE to confirm related data removal.');
    const account = await tx.socialAccount.findFirst({ where: { id: socialAccountId, workspaceId: actor.workspaceId }, select: { id: true, targets: { select: { id: true } }, adAccounts: { select: { id: true } } } });
    if (!account) throw new Error('This source is unavailable in the current workspace.');
    const targetIds = account.targets.map(item => item.id);
    const adAccountIds = account.adAccounts.map(item => item.id);
    const stillScheduled = targetIds.length ? await tx.postTarget.count({ where: { targetId: { in: targetIds }, status: 'scheduled_remote' } }) : 0;

    if (mode === 'retain') {
      await tx.target.updateMany({ where: { workspaceId: actor.workspaceId, id: { in: targetIds } }, data: { enabled: false } });
      await tx.adAccount.updateMany({ where: { workspaceId: actor.workspaceId, id: { in: adAccountIds } }, data: { enabled: false } });
      const instagramAccounts = await linkedInstagramAccounts(tx, actor.workspaceId, account.id, targetIds);
      await tx.instagramAccount.updateMany({ where: { workspaceId: actor.workspaceId, id: { in: instagramAccounts.map(item => item.id) } }, data: { enabled: false } });
      await tx.socialAccount.updateMany({ where: { id: account.id, workspaceId: actor.workspaceId }, data: { invalidatedAt: new Date() } });
      await auditConnectionEvent(tx, actor, 'connection.local_disconnected', { socialAccountId: account.id, channels: targetIds.length, adAccounts: adAccountIds.length, instagramAccounts: instagramAccounts.length, retained: true, stillScheduled });
      return { mode, stillScheduled, retained: { channels: targetIds.length, adAccounts: adAccountIds.length, instagramAccounts: instagramAccounts.length } };
    }

    if (stillScheduled > 0) throw new Error('This source has posts still scheduled at the provider. Cancel or reconcile those posts before deleting its local records.');

    const targetLinks = targetIds.length ? await tx.postTarget.findMany({ where: { targetId: { in: targetIds } }, select: { id: true, postId: true } }) : [];
    const instagramAccounts = await linkedInstagramAccounts(tx, actor.workspaceId, account.id, targetIds);
    const instagramAccountIds = instagramAccounts.map(item => item.id);
    const targetLinkIds = targetLinks.map(row => row.id);
    const affectedPostIds = [...new Set(targetLinks.map(row => row.postId))];
    const conversations = targetIds.length ? await tx.conversation.findMany({ where: { targetId: { in: targetIds } }, select: { id: true } }) : [];
    const conversationIds = conversations.map(row => row.id);
    const comments = targetLinkIds.length ? await tx.postComment.deleteMany({ where: { postTargetId: { in: targetLinkIds } } }) : { count: 0 };
    if (targetLinkIds.length) await tx.postTarget.deleteMany({ where: { id: { in: targetLinkIds } } });
    const orphanPosts = affectedPostIds.length ? await tx.post.deleteMany({ where: { id: { in: affectedPostIds }, workspaceId: actor.workspaceId, targets: { none: {} } } }) : { count: 0 };
    const conversationMessages = conversationIds.length ? await tx.conversationMessage.deleteMany({ where: { conversationId: { in: conversationIds } } }) : { count: 0 };
    const deletedConversations = conversationIds.length ? await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } }) : { count: 0 };
    const insights = targetIds.length ? await tx.pageInsight.deleteMany({ where: { targetId: { in: targetIds } } }) : { count: 0 };
    const adInsights = adAccountIds.length ? await tx.adInsight.deleteMany({ where: { adAccountId: { in: adAccountIds } } }) : { count: 0 };
    const instagramMedia = instagramAccountIds.length ? await tx.instagramMedia.deleteMany({ where: { accountId: { in: instagramAccountIds } } }) : { count: 0 };
    const instagramInsights = instagramAccountIds.length ? await tx.instagramInsight.deleteMany({ where: { accountId: { in: instagramAccountIds } } }) : { count: 0 };
    const deletedInstagramAccounts = instagramAccountIds.length ? await tx.instagramAccount.deleteMany({ where: { workspaceId: actor.workspaceId, id: { in: instagramAccountIds } } }) : { count: 0 };
    await tx.target.deleteMany({ where: { workspaceId: actor.workspaceId, id: { in: targetIds } } });
    await tx.adAccount.deleteMany({ where: { workspaceId: actor.workspaceId, id: { in: adAccountIds } } });
    await tx.socialAccount.deleteMany({ where: { id: account.id, workspaceId: actor.workspaceId } });
    const counts = { channels: targetIds.length, adAccounts: adAccountIds.length, postTargets: targetLinks.length, orphanPosts: orphanPosts.count, comments: comments.count, conversations: deletedConversations.count, conversationMessages: conversationMessages.count, pageInsights: insights.count, adInsights: adInsights.count, instagramAccounts: deletedInstagramAccounts.count, instagramInsights: instagramInsights.count, instagramMedia: instagramMedia.count, scheduledRemote: stillScheduled };
    await auditConnectionEvent(tx, actor, 'connection.local_disconnected', { socialAccountId: account.id, retained: false, counts });
    return { mode, deleted: counts, stillScheduled };
  });
}

export interface FacebookDiscoveryPersistenceInput {
  user: FacebookCurrentUser;
  accessToken: string;
  expiresAt: Date | null;
  scopes: string[];
  pages: FacebookPage[];
  adAccounts: FacebookAdAccount[];
}

/** Persist discovered Meta records without activating any new workspace destinations. */
export async function persistFacebookDiscovery(actor: ConnectionMutationActor, input: FacebookDiscoveryPersistenceInput) {
  const now = new Date();
  return prisma.$transaction(async tx => {
    const membership = await tx.membership.findUnique({
      where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
      select: { role: true },
    });
    if (!membership || !MANAGER_ROLES.has(membership.role)) throw new Error('Only current workspace owners and admins can connect Meta.');
    const account = await tx.socialAccount.upsert({
      where: { workspaceId_provider_providerUserId: { workspaceId: actor.workspaceId, provider: 'facebook', providerUserId: input.user.id } },
      create: {
        id: randomUUID(), workspaceId: actor.workspaceId, provider: 'facebook', providerUserId: input.user.id,
        name: input.user.name, pictureUrl: input.user.pictureUrl, accessToken: encryptSecret(input.accessToken),
        tokenExpiresAt: input.expiresAt, refreshToken: null, scopes: input.scopes.join(','), invalidatedAt: null, invalidReason: null,
        createdAt: now, updatedAt: now,
      },
      update: {
        name: input.user.name, pictureUrl: input.user.pictureUrl, accessToken: encryptSecret(input.accessToken),
        tokenExpiresAt: input.expiresAt, refreshToken: null, scopes: input.scopes.join(','), invalidatedAt: null, invalidReason: null, updatedAt: now,
      },
      select: { id: true },
    });

    let savedPages = 0;
    let skippedPages = 0;
    for (const page of input.pages) {
      const existing = await tx.target.findUnique({ where: { workspaceId_providerId: { workspaceId: actor.workspaceId, providerId: page.id } }, select: { id: true, socialAccountId: true } });
      const pageData = {
        socialAccountId: account.id, type: 'page' as const, name: page.name, pictureUrl: null,
        accessToken: encryptSecret(page.accessToken), canPublish: true,
      };
      if (!existing) {
        await tx.target.create({ data: { id: randomUUID(), workspaceId: actor.workspaceId, providerId: page.id, ...pageData, enabled: false, createdAt: now } });
        savedPages++;
      } else if (existing.socialAccountId === null || existing.socialAccountId === account.id) {
        await tx.target.update({ where: { id: existing.id }, data: { ...pageData, ...(existing.socialAccountId === null ? { enabled: false } : {}) } });
        savedPages++;
      } else {
        // A destination already owned by another connected profile must not be silently reassigned.
        skippedPages++;
      }
    }

    let savedAdAccounts = 0;
    let skippedAdAccounts = 0;
    for (const adAccount of input.adAccounts) {
      const existing = await tx.adAccount.findUnique({ where: { workspaceId_actId: { workspaceId: actor.workspaceId, actId: adAccount.id } }, select: { id: true, socialAccountId: true } });
      const adData = { name: adAccount.name, currency: adAccount.currency, accountStatus: adAccount.status, socialAccountId: account.id };
      if (!existing) {
        await tx.adAccount.create({ data: { id: randomUUID(), workspaceId: actor.workspaceId, actId: adAccount.id, ...adData, enabled: false } });
        savedAdAccounts++;
      } else if (existing.socialAccountId === null || existing.socialAccountId === account.id) {
        await tx.adAccount.update({ where: { id: existing.id }, data: { ...adData, ...(existing.socialAccountId === null ? { enabled: false } : {}) } });
        savedAdAccounts++;
      } else {
        skippedAdAccounts++;
      }
    }

    await auditConnectionEvent(tx, actor, 'connection.facebook_connected', {
      providerUserId: input.user.id, pages: savedPages, adAccounts: savedAdAccounts,
      skippedPages, skippedAdAccounts,
    });
    return { pages: savedPages, adAccounts: savedAdAccounts, skippedPages, skippedAdAccounts };
  });
}

export async function recordFacebookConnectionFailure(actor: ConnectionMutationActor, stage: string, category: 'provider_error' | 'internal_error') {
  try {
    await prisma.$transaction(tx => auditConnectionEvent(tx, actor, 'connection.facebook_connect_failed', { stage, category }));
  } catch {
    // A failed audit write must not expose provider details or mask the generic connection error.
  }
}

export async function auditConnectionEvent(tx: import('../../generated/client').Prisma.TransactionClient, actor: ConnectionMutationActor, action: string, detail: Record<string, unknown>) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`conn_${randomBytes(12).toString('hex')}`}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;
}
