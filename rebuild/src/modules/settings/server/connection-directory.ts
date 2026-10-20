import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { connectionState } from '@/lib/connection-status';
import { summarizeConnectionHealth } from '@/lib/connection-health';
import { listConnections, prisma } from '@/server/data';
import { platformGrantHealth } from '@/server/platforms/registry';
import { canUseFeature, loadEntitlements, entitledPlatformIds } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { runtimeConfig } from '@/server/config/store';

export async function readConnectionDirectory(actor: { userId: string; workspaceId: string }, input: unknown = {}, maxItems?: number) {
  const parsed = z.object({ offset: z.number().int().safe().nonnegative().optional() }).strict().safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose a valid connection page.');
  const [user, membership, entitlements, permissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!user || user.disabledAt || !membership || !['owner', 'admin'].includes(membership.role) || !entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions || !canUseFeature(entitlements, 'settings/connections') || !canAccessFeature(permissions, 'settings/connections', 'read')) throw new OperationError('forbidden', 'Connection management is unavailable.');
  const configured = await runtimeConfig('settings.connectionDirectoryPageSize');
  const cap = maxItems === undefined ? configured : Math.min(configured, z.number().int().positive().parse(maxItems));
  const offset = parsed.data.offset ?? 0;
  const accounts = await listConnections(actor.workspaceId, entitledPlatformIds(entitlements));
  const now = new Date();
  const items = await Promise.all(accounts.slice(offset, offset + cap).map(async account => {
    const health = summarizeConnectionHealth(account, await platformGrantHealth(account.provider, { scopes: account.scopes, hasAdAccounts: account.adAccounts.length > 0, locale: 'en' }), now);
    return {
      id: account.id, provider: account.provider, name: account.name, state: connectionState(account, now),
      tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null, reconnectRecommended: health.reconnectRecommended,
      missingPermissions: health.missing.map(group => group.label), addedAt: account.createdAt.toISOString(),
      channels: account.targets.map(target => ({ id: target.id, type: target.type, name: target.name, selected: target.enabled })),
      adAccounts: account.adAccounts.map(ad => ({ id: ad.id, name: ad.name, selected: ad.enabled })),
    };
  }));
  return { connections: items, total: accounts.length, hasMore: offset + items.length < accounts.length, nextOffset: offset + items.length < accounts.length ? offset + items.length : null };
}
