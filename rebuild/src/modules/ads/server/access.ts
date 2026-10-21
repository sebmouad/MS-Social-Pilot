import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import { prisma } from '@/server/data';
import { canUseFeature, entitledPlatformIds, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { OperationError } from '@/lib/operation-error';

export type AdsReadActor = { allowedPlatformIds?: readonly string[]; userId: string; workspaceId: string; allowedTargetIds?: readonly string[]; /** Explicit ad-account ceiling: [] means none, undefined means no account-level restriction. */ allowedAdAccountIds?: readonly string[] };

/** Recheck all customer report permissions and intersect caller-provided scope with current grants. */
export async function authorizeAdsRead(actor: AdsReadActor, feature: 'ads/campaigns' | 'ads/compare' | 'ads/objects' = 'ads/campaigns') {
  return withAdsCopySnapshot(async () => {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) throw new OperationError('unauthorized', await adsServiceText('service001'));

  const [membership, entitlements, permissions] = await Promise.all([
    prisma.membership.findFirst({ where: { userId: actor.userId, workspaceId: actor.workspaceId }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!membership || !entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions ||
    !canUseFeature(entitlements, feature) || !canAccessFeature(permissions, feature, 'read')) {
    throw new OperationError('forbidden', await adsServiceText('service002'));
  }
  await assertWorkspaceNotPurging(actor.workspaceId);

  const grants = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowedTargetIds = actor.allowedTargetIds === undefined
    ? grants
    : actor.allowedTargetIds.filter(id => grants === undefined || grants.includes(id));
  return {
    actor: { userId: actor.userId, workspaceId: actor.workspaceId, ...(allowedTargetIds === undefined ? {} : { allowedTargetIds }), ...(actor.allowedAdAccountIds === undefined ? {} : { allowedAdAccountIds: actor.allowedAdAccountIds }) },
    role: membership.role,
    permissions,
    entitlements,
    allowedTargetIds,
    allowedAdAccountIds: actor.allowedAdAccountIds,
    allowedProviders: entitledPlatformIds(entitlements).filter(id => actor.allowedPlatformIds === undefined || actor.allowedPlatformIds.includes(id)),
  };

  });
}
