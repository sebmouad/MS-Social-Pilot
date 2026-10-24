
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { prisma } from '@/server/data';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { OperationError } from '@/lib/operation-error';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import type { PublishingActor, PublishingAuthorization, PublishingFeature } from './types';

/** Rebuild authorization from the current account, membership, Root switches and grants. */
export async function authorizePublishing(
  actor: PublishingActor,
  feature: PublishingFeature = 'publishing/posts',
  access: 'read' | 'write' = 'write',
): Promise<PublishingAuthorization> {
  const errorText = await loadPublishingErrorText();
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) throw new PublishingOperationError('unauthorized', 'signInWithAnActiveAccountToManagePosts', {}, errorText);

  const [entitlements, permissions, membership] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
    prisma.membership.findFirst({ where: { userId: actor.userId, workspaceId: actor.workspaceId }, select: { role: true } }),
  ]);
  if (!membership || !entitlements || !permissions || !canUseFeature(entitlements, feature) || !canAccessFeature(permissions, feature, access)) {
    throw new PublishingOperationError('forbidden', 'publishingAccessIsUnavailableInThisWorkspace', {}, errorText);
  }
  await assertWorkspaceNotPurging(actor.workspaceId);

  const currentGrants = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowedTargetIds = actor.allowedTargetIds === undefined
    ? currentGrants
    : actor.allowedTargetIds.filter(id => currentGrants === undefined || currentGrants.includes(id));
  return {
    actor: { userId: actor.userId, workspaceId: actor.workspaceId, ...(allowedTargetIds === undefined ? {} : { allowedTargetIds }) },
    role: membership.role,
    permissions,
    entitlements,
  };
}
