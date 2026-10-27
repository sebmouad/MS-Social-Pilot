import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { encryptSecret } from '@/server/secret-crypto';
import type { FacebookAdAccount, FacebookCurrentUser, FacebookPage } from '@/platforms/facebook/publishing';
import { auditConnectionEvent, type ConnectionMutationActor } from '@/server/connection-mutations';
import { lockSelectedResources } from '@/server/platforms/resource-lock';

export interface FacebookDiscoveryPersistenceInput {
  user: FacebookCurrentUser;
  accessToken: string;
  expiresAt: Date | null;
  scopes: string[];
  pages: FacebookPage[];
  adAccounts: FacebookAdAccount[];
}

/** Persist Facebook-discovered records without activating new workspace destinations. */
export async function persistFacebookDiscovery(actor: ConnectionMutationActor, input: FacebookDiscoveryPersistenceInput) {
  const now = new Date();
  return prisma.$transaction(async tx => {
    const membership = await tx.membership.findUnique({
      where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
      select: { role: true },
    });
    if (!membership || !new Set(['owner', 'admin']).has(membership.role)) throw new Error('Only current workspace owners and admins can connect Meta.');
    // Reconnection rotates source credentials as well as discovered targets.
    // Fence every existing bound resource before changing that shared source.
    const previous = await tx.socialAccount.findUnique({
      where: { workspaceId_provider_providerUserId: { workspaceId: actor.workspaceId, provider: 'facebook', providerUserId: input.user.id } },
      select: { id: true },
    });
    const [existingTargets, existingAds] = await Promise.all([
      tx.target.findMany({ where: { workspaceId: actor.workspaceId, OR: [
        { providerId: { in: input.pages.map(page => page.id) } }, ...(previous ? [{ socialAccountId: previous.id }] : []),
      ] }, select: { id: true } }),
      tx.adAccount.findMany({ where: { workspaceId: actor.workspaceId, OR: [
        { actId: { in: input.adAccounts.map(account => account.id) } }, ...(previous ? [{ socialAccountId: previous.id }] : []),
      ] }, select: { id: true } }),
    ]);
    await lockSelectedResources(tx, actor.workspaceId, [
      ...existingTargets.map(target => ({ kind: 'target' as const, id: target.id })),
      ...existingAds.map(account => ({ kind: 'adAccount' as const, id: account.id })),
    ]);
    const account = await tx.socialAccount.upsert({
      where: { workspaceId_provider_providerUserId: { workspaceId: actor.workspaceId, provider: 'facebook', providerUserId: input.user.id } },
      create: {
        id: randomUUID(), workspaceId: actor.workspaceId, provider: 'facebook', providerUserId: input.user.id,
        name: input.user.name, pictureUrl: input.user.pictureUrl, profileUrl: input.user.profileUrl, accessToken: encryptSecret(input.accessToken),
        tokenExpiresAt: input.expiresAt, refreshToken: null, scopes: input.scopes.join(','), invalidatedAt: null, invalidReason: null,
        createdAt: now, updatedAt: now,
      },
      update: {
        name: input.user.name, pictureUrl: input.user.pictureUrl, profileUrl: input.user.profileUrl, accessToken: encryptSecret(input.accessToken),
        tokenExpiresAt: input.expiresAt, refreshToken: null, scopes: input.scopes.join(','), invalidatedAt: null, invalidReason: null, updatedAt: now,
      },
      select: { id: true },
    });

    let savedPages = 0;
    let skippedPages = 0;
    for (const page of input.pages) {
      const existing = await tx.target.findUnique({ where: { workspaceId_providerId: { workspaceId: actor.workspaceId, providerId: page.id } }, select: { id: true, socialAccountId: true } });
      const pageData = {
        socialAccountId: account.id, type: 'page' as const, name: page.name,
        accessToken: encryptSecret(page.accessToken), canPublish: true,
      };
      if (!existing) {
        const id = randomUUID();
        // Served with the Page's own token (app/api/channels/[id]/picture); CDN picture URLs are signed and expire.
        await tx.target.create({ data: { id, workspaceId: actor.workspaceId, providerId: page.id, ...pageData, pictureUrl: `/api/channels/${id}/picture`, enabled: false, createdAt: now } });
        savedPages++;
      } else if (existing.socialAccountId === null || existing.socialAccountId === account.id) {
        await tx.target.update({ where: { id: existing.id }, data: { ...pageData, pictureUrl: `/api/channels/${existing.id}/picture`, ...(existing.socialAccountId === null ? { enabled: false } : {}) } });
        savedPages++;
      } else {
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
    // Keep audit failures from exposing provider details or masking the generic connection error.
  }
}
