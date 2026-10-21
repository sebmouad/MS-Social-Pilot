import { inboxServiceText } from './service-copy';
import { prisma } from '@/server/data';
import { canUseFeature, hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { inboxProviders, inboxTargetWhere } from '@/modules/inbox/server/providers';
import { OperationError } from '@/lib/operation-error';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import type { InboxReadActor, InboxReadConstraints } from './types';

export async function authorizeInbox(actor: InboxReadActor, constraints: InboxReadConstraints = {}, mode: 'read' | 'write' = 'read') {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) throw new OperationError('unauthorized', await inboxServiceText('service1'));
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || !permissions || !canUseFeature(entitlements, 'inbox/conversations') || !canAccessFeature(permissions, 'inbox/conversations', mode)) {
    throw new OperationError('forbidden', await inboxServiceText('service2'));
  }
  await assertWorkspaceNotPurging(actor.workspaceId);
  if (constraints.maxItems !== undefined && (!Number.isSafeInteger(constraints.maxItems) || constraints.maxItems < 1)) {
    throw new OperationError('invalid_request', await inboxServiceText('service3'));
  }
  const grants = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowed = constraints.allowedChannelIds === undefined ? grants : constraints.allowedChannelIds.filter(id => grants === undefined || grants.includes(id));
  const entitledProviders = (await inboxProviders()).filter(provider => hasPlatformCapability(entitlements, provider));
  const [channels, workspace] = await Promise.all([
    prisma.target.findMany({ where: await inboxTargetWhere(actor.workspaceId, allowed, entitledProviders), orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true } }),
    prisma.workspace.findUnique({ where: { id: actor.workspaceId }, select: { timezone: true } }),
  ]);
  if (!workspace) throw new OperationError('unavailable', await inboxServiceText('service4'));
  return { channels, channelIds: channels.map(channel => channel.id), timeZone: workspace.timezone };
}
