import { prisma } from '@/server/data';
import { canUseFeature, entitledPlatformIds, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { OperationError } from '@/lib/operation-error';

export type AdsReadActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] };

/** Recheck all customer report permissions and intersect caller-provided scope with current grants. */
export async function authorizeAdsRead(actor: AdsReadActor) {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) throw new OperationError('unauthorized', 'Sign in with an active account to view Ads reports.');

  const [membership, entitlements, permissions] = await Promise.all([
    prisma.membership.findFirst({ where: { userId: actor.userId, workspaceId: actor.workspaceId }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!membership || !entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions ||
    !canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', 'read')) {
    throw new OperationError('forbidden', 'Ads report access is unavailable in this workspace.');
  }
  await assertWorkspaceNotPurging(actor.workspaceId);

  const grants = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowedTargetIds = actor.allowedTargetIds === undefined
    ? grants
    : actor.allowedTargetIds.filter(id => grants === undefined || grants.includes(id));
  return {
    actor: { userId: actor.userId, workspaceId: actor.workspaceId, ...(allowedTargetIds === undefined ? {} : { allowedTargetIds }) },
    role: membership.role,
    permissions,
    entitlements,
    allowedTargetIds,
    allowedProviders: entitledPlatformIds(entitlements),
  };
}
