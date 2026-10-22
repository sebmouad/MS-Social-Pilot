import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { PlatformHost, ConnectionViewer } from '@/server/platforms/host';
import type { PlatformTarget } from '../types';
import { prisma } from '@/server/data';
import { encryptSecret } from '@/server/secret-crypto';
import { requestOrigin } from '@/server/request-origin';
import { OperationError } from '@/lib/operation-error';
import { loadEntitlements, canUseFeature, hasPlatformCapability } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { isPlatformEnabled } from '@/server/platforms/registry';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { lockSelectedResources } from '@/server/platforms/resource-lock';
import { auditConnectionEvent } from '@/modules/settings/server/connection-mutations';
import { configuredEngine, configuredPolicy, configuredCredentials } from './runtime';
import { createState, openState } from './oauth-state';

// Host route and cookie names are module protocol identities, not deployment URLs.
export const CALLBACK_PATH = '/api/connections/linkedin/callback';
export const STATE_COOKIE = 'msp_linkedin_oauth';
export async function authorizeConnection(viewer: ConnectionViewer) {
  const [membership, permissions, access] = await Promise.all([
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: viewer.user.id, workspaceId: viewer.workspaceId } }, select: { role: true } }),
    loadPermissions(viewer.user.id, viewer.workspaceId), loadEntitlements(viewer.user.id, viewer.workspaceId, { allowInstallationInspection: false }),
  ]);
  if (!membership || !['owner', 'admin'].includes(membership.role) || !permissions || !canAccessFeature(permissions, 'settings/connections', 'write') || !access || access.workspaceId !== viewer.workspaceId || !canUseFeature(access, 'settings/connections') || !hasPlatformCapability(access, 'linkedin') || !await isPlatformEnabled('linkedin')) throw new OperationError('forbidden', (await configuredPolicy()).copy.permission.en);
}
export async function persistDiscovery(viewer: ConnectionViewer, input: { user: { id: string; name: string; pictureUrl: string | null }; accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string[]; targets: PlatformTarget[] }) {
  await authorizeConnection(viewer);
  const policy = await configuredPolicy();
  return prisma.$transaction(async tx => {
    const membership = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: viewer.user.id, workspaceId: viewer.workspaceId } }, select: { role: true } });
    if (!membership || !['owner', 'admin'].includes(membership.role)) throw new OperationError('forbidden', (await configuredPolicy()).copy.permission.en);
    const existing = await tx.socialAccount.findUnique({ where: { workspaceId_provider_providerUserId: { workspaceId: viewer.workspaceId, provider: 'linkedin', providerUserId: input.user.id } }, select: { id: true } });
    const targets = await tx.target.findMany({ where: { workspaceId: viewer.workspaceId, OR: [{ providerId: { in: input.targets.map(target => target.id) } }, ...(existing ? [{ socialAccountId: existing.id }] : [])] }, select: { id: true } });
    await lockSelectedResources(tx, viewer.workspaceId, targets.map(target => ({ kind: 'target', id: target.id })));
    const credentials = { accessToken: encryptSecret(input.accessToken), refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null, tokenExpiresAt: input.expiresAt, scopes: input.scopes.join(','), invalidatedAt: null, invalidReason: null };
    const source = await tx.socialAccount.upsert({
      where: { workspaceId_provider_providerUserId: { workspaceId: viewer.workspaceId, provider: 'linkedin', providerUserId: input.user.id } },
      create: { id: randomUUID(), workspaceId: viewer.workspaceId, provider: 'linkedin', providerUserId: input.user.id, name: input.user.name, pictureUrl: input.user.pictureUrl, ...credentials },
      update: { name: input.user.name, pictureUrl: input.user.pictureUrl, ...credentials }, select: { id: true },
    });
    let saved = 0, skipped = 0;
    for (const target of input.targets) {
      const previous = await tx.target.findUnique({ where: { workspaceId_providerId: { workspaceId: viewer.workspaceId, providerId: target.id } }, select: { id: true, socialAccountId: true, type: true } });
      // A global legacy providerId namespace must never transfer another provider's resource.
      if (previous && (previous.socialAccountId !== source.id || previous.type !== 'linkedin')) { skipped++; continue; }
      const canPublish = (target.id.startsWith('urn:li:organization:') ? policy.organizationPublishScopes : policy.memberPublishScopes).every(scope => input.scopes.includes(scope));
      const data = { socialAccountId: source.id, type: 'linkedin' as const, name: target.name, accessToken: credentials.accessToken, canPublish };
      if (previous) await tx.target.update({ where: { id: previous.id }, data });
      else await tx.target.create({ data: { id: randomUUID(), workspaceId: viewer.workspaceId, providerId: target.id, ...data, enabled: false, createdAt: new Date() } });
      saved++;
    }
    // Removed grants must not leave old selected destinations usable after reconnect.
    await tx.target.updateMany({ where: { workspaceId: viewer.workspaceId, socialAccountId: source.id, providerId: { notIn: input.targets.map(target => target.id) } }, data: { canPublish: false, enabled: false } });
    await auditConnectionEvent(tx, { userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'connection.linkedin_connected', { socialAccountId: source.id, saved, skipped });
    return { saved, skipped };
  });
}
export const linkedinConnection: PlatformHost['connection'] = {
  async isReady() { try { await Promise.all([configuredCredentials(), configuredPolicy()]); return true; } catch { return false; } },
  async start(request, viewer) {
    await authorizeConnection(viewer);
    const [policy, credentials, engine] = await Promise.all([configuredPolicy(), configuredCredentials(), configuredEngine()]);
    const redirectUri = new URL(CALLBACK_PATH, requestOrigin(request)).toString();
    const pending = createState(viewer.user.id, viewer.workspaceId, redirectUri, policy.stateTtlSeconds);
    const scopes = [...new Set([...policy.scopes, ...(policy.organizationsEnabled ? policy.organizationScopes : [])])];
    const response = NextResponse.json({ authorizationUrl: engine.adapter.getAuthorizationUrl!({ appId: credentials.appId, redirectUri, state: pending.state, scopes }) }, { headers: { 'cache-control': 'no-store' } });
    response.cookies.set(STATE_COOKIE, pending.cookie, { httpOnly: true, sameSite: 'lax', secure: new URL(redirectUri).protocol === 'https:', path: CALLBACK_PATH, maxAge: policy.stateTtlSeconds });
    return response;
  },
  async callback(request, viewer) {
    const redirectUri = new URL(CALLBACK_PATH, requestOrigin(request)).toString();
    const finish = (notice: string) => {
      const response = NextResponse.redirect(new URL(`/settings/connections?notice=${notice}${notice === 'connected' || notice === 'connected_partial' ? '&select=1' : ''}`, requestOrigin(request)), { status: 303, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
      response.cookies.set(STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: new URL(redirectUri).protocol === 'https:', path: CALLBACK_PATH, maxAge: 0 });
      return response;
    };
    const params = new URL(request.url).searchParams;
    if (!openState(request.cookies.get(STATE_COOKIE)?.value, params.get('state'), viewer.user.id, viewer.workspaceId, redirectUri)) return finish('oauth_invalid_state');
    if (params.has('error')) return finish('oauth_cancelled');
    try {
      return await withWorkspaceOperation(viewer.workspaceId, async () => {
        await authorizeConnection(viewer);
        const [policy, credentials, engine] = await Promise.all([configuredPolicy(), configuredCredentials(), configuredEngine()]);
        const code = params.get('code');
        if (!code || code.length > policy.codeMaxLength) return finish('connect_failed');
        const token = await engine.exchange({ ...credentials, redirectUri, code });
        const [user, discovery] = await Promise.all([engine.currentUser(token.accessToken), engine.adapter.discover!({ credential: { accessToken: token.accessToken, grantedScopes: token.scopes } })]);
        const result = await persistDiscovery(viewer, { user, ...token, targets: discovery.targets });
        return finish(result.skipped ? 'connected_partial' : 'connected');
      });
    } catch {
      try { await prisma.$transaction(tx => auditConnectionEvent(tx, { userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'connection.linkedin_connect_failed', { category: 'connection_failure' })); } catch { /* Do not disclose private provider failures. */ }
      return finish('connect_failed');
    }
  },
  async grantHealth({ scopes, locale = 'en' }) {
    const policy = await configuredPolicy();
    const granted = scopes?.split(/[\s,]+/).filter(Boolean);
    return [{ id: 'publishing', label: policy.copy.publishing[locale], state: !granted?.length ? 'unknown' : policy.memberPublishScopes.every(scope => granted.includes(scope)) || policy.organizationPublishScopes.every(scope => granted.includes(scope)) ? 'granted' : 'missing' }];
  },
};
