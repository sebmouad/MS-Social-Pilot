import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { PlatformHost, ConnectionViewer } from '@/server/platforms/host';
import { prisma } from '@/server/data';
import { encryptSecret, decryptSecret } from '@/server/secret-crypto';
import { OperationError } from '@/lib/operation-error';
import { canUseFeature, hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { isPlatformEnabled } from '@/server/platforms/registry';
import { lockSelectedResources } from '@/server/platforms/resource-lock';
import { auditConnectionEvent } from '@/modules/settings/server/connection-mutations';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { requestOrigin } from '@/server/request-origin';
import { configuredInstagramDiscovery, configuredInstagramPolicy } from './runtime';
import { runtimeSecret } from '@/server/config/store';
import { instagramLocale } from './locale';
import { connectionState } from '@/lib/connection-status';

async function authorize(viewer: ConnectionViewer) {
  const [membership, permissions, access] = await Promise.all([
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: viewer.user.id, workspaceId: viewer.workspaceId } }, select: { role: true } }),
    loadPermissions(viewer.user.id, viewer.workspaceId),
    loadEntitlements(viewer.user.id, viewer.workspaceId, { allowInstallationInspection: false }),
  ]);
  if (!membership || !['owner', 'admin'].includes(membership.role) || !permissions || !canAccessFeature(permissions, 'settings/connections', 'write') || !access || access.workspaceId !== viewer.workspaceId || !canUseFeature(access, 'settings/connections') || !hasPlatformCapability(access, 'instagram') || !await isPlatformEnabled('instagram')) throw new OperationError('forbidden', (await configuredInstagramPolicy()).copy.permission[await instagramLocale()]);
}

/** The confirmed shared connection-start service enters here. Only selected, live Page sources are read. */
export async function discoverSelectedInstagramAccounts(viewer: ConnectionViewer) {
  await authorize(viewer);
  const [policy, discover] = await Promise.all([configuredInstagramPolicy(), configuredInstagramDiscovery()]);
  const pages = await prisma.target.findMany({
    where: { workspaceId: viewer.workspaceId, type: 'page', enabled: true, accessToken: { not: null }, socialAccount: { workspaceId: viewer.workspaceId, provider: 'facebook', invalidatedAt: null, OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: new Date() } }] } },
    include: { socialAccount: true }, orderBy: { id: 'asc' }, take: policy.connectionMaxPages + 1,
  });
  if (!pages.length || pages.length > policy.connectionMaxPages) throw new OperationError('unavailable', policy.copy.permission[await instagramLocale()]);
  let saved = 0;
  for (const page of pages) {
    const source = page.socialAccount;
    if (!source || !page.accessToken || connectionState(source) !== 'connected') continue;
    const scopes = source.scopes.split(',').filter(Boolean);
    if (!policy.readScopes.every(scope => scopes.includes(scope))) continue;
    const linked = await discover([{ id: page.providerId, name: page.name, accessToken: decryptSecret(page.accessToken) }]);
    // No network under locks. Recheck role, configuration, source binding, expiry and selection before saving.
    await authorize(viewer);
    await prisma.$transaction(async tx => {
      await lockSelectedResources(tx, viewer.workspaceId, [{ kind: 'target', id: page.id }]);
      const current = await tx.target.findFirst({ where: { id: page.id, workspaceId: viewer.workspaceId, enabled: true, socialAccountId: source.id, accessToken: page.accessToken }, include: { socialAccount: true } });
      const membership = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: viewer.user.id, workspaceId: viewer.workspaceId } }, select: { role: true } });
      if (!membership || !['owner', 'admin'].includes(membership.role) || !current?.socialAccount || connectionState(current.socialAccount) !== 'connected' || current.socialAccount.scopes !== source.scopes) throw new OperationError('forbidden', policy.copy.permission[await instagramLocale()]);
      for (const account of linked) {
        const previous = await tx.target.findUnique({ where: { workspaceId_providerId: { workspaceId: viewer.workspaceId, providerId: account.igUserId } }, include: { socialAccount: true } });
        // Never take another connection's destination or inherit its selection.
        if (previous && (previous.type !== 'instagram' || !(previous.socialAccount?.provider === 'instagram' && previous.socialAccount.providerUserId === account.igUserId || previous.socialAccountId === source.id))) continue;
        if (previous) await lockSelectedResources(tx, viewer.workspaceId, [{ kind: 'target', id: previous.id }]);
        const credentials = { accessToken: encryptSecret(account.pageAccessToken), tokenExpiresAt: source.tokenExpiresAt, scopes: source.scopes, invalidatedAt: null, invalidReason: null };
        const social = await tx.socialAccount.upsert({
          where: { workspaceId_provider_providerUserId: { workspaceId: viewer.workspaceId, provider: 'instagram', providerUserId: account.igUserId } },
          create: { id: randomUUID(), workspaceId: viewer.workspaceId, provider: 'instagram', providerUserId: account.igUserId, name: account.username, ...credentials },
          update: { name: account.username, ...credentials },
        });
        const binding = JSON.stringify({ pageId: page.id, sourceId: source.id, remotePageId: account.pageId });
        await tx.$executeRaw`UPDATE social_accounts SET meta=${binding}::jsonb WHERE id=${social.id} AND "workspaceId"=${viewer.workspaceId} AND provider='instagram'`;
        const target = await tx.target.upsert({
          where: { workspaceId_providerId: { workspaceId: viewer.workspaceId, providerId: account.igUserId } },
          create: { id: randomUUID(), workspaceId: viewer.workspaceId, providerId: account.igUserId, socialAccountId: social.id, type: 'instagram', createdAt: new Date(), name: account.username, accessToken: credentials.accessToken, enabled: false, canPublish: policy.publishScopes.every(scope => scopes.includes(scope)) },
          update: { ...(previous?.socialAccountId !== social.id ? { enabled: false } : {}), socialAccountId: social.id, name: account.username, accessToken: credentials.accessToken, canPublish: policy.publishScopes.every(scope => scopes.includes(scope)) },
        });
        await tx.instagramAccount.upsert({
          where: { workspaceId_igUserId: { workspaceId: viewer.workspaceId, igUserId: account.igUserId } },
          create: { id: randomUUID(), workspaceId: viewer.workspaceId, igUserId: account.igUserId, createdAt: new Date(), username: account.username, targetId: target.id, socialAccountId: social.id, enabled: false },
          update: { username: account.username, targetId: target.id, socialAccountId: social.id, enabled: target.enabled },
        });
        saved++;
      }
      await auditConnectionEvent(tx, { userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'connection.instagram_discovered', { pageId: page.id, accounts: linked.length });
    });
  }
  return { saved };
}

export const instagramConnection: PlatformHost['connection'] = {
  isReady: async () => Boolean(await runtimeSecret('instagram.appSecret')),
  async start(request, viewer) {
    await withWorkspaceOperation(viewer.workspaceId, () => discoverSelectedInstagramAccounts(viewer));
    return NextResponse.json({ authorizationUrl: new URL('/settings/channels?notice=connected&select=1', requestOrigin(request)).toString() }, { headers: { 'cache-control': 'no-store' } });
  },
  // This linked-Page flow has no OAuth callback and never accepts callback writes.
  async callback(request) {
    return NextResponse.redirect(new URL('/settings/channels', requestOrigin(request)), { status: 303 });
  },
  async grantHealth({ scopes, locale = 'en' }) {
    const policy = await configuredInstagramPolicy();
    const granted = scopes?.split(',').filter(Boolean);
    return [
      { id: 'publishing', label: policy.copy.publishing[locale], required: policy.publishScopes },
      { id: 'comments', label: policy.copy.comments[locale], required: policy.commentScopes },
      { id: 'analytics', label: policy.copy.analytics[locale], required: policy.insightScopes },
    ].map(({ id, label, required }) => ({ id, label, state: !granted?.length ? 'unknown' : required.every(scope => granted.includes(scope)) ? 'granted' : 'missing' }));
  },
};
