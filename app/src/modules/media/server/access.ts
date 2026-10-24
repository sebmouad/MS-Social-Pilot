import { prisma } from '@/server/data';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { mediaError } from './messages';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import type { FeatureId } from '@/lib/product';
import type { Entitlements } from '@/server/entitlements';
import type { ScopedPermissions } from '@/server/permissions';

export type ToolActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] };
export type ToolAuthorization = { actor: ToolActor; role: string; permissions: ScopedPermissions; entitlements: Entitlements; workspaceWide: boolean };

/**
 * Current-authority check shared by feeds, AI assist and the media library.
 * Re-reads the account, membership, plan and grants on every call; hiding a
 * control is never the security boundary. Feature ids are existing registered
 * pages (see docs/FEEDS_AI_MEDIA.md for the dedicated-feature patch).
 */
export async function authorizeFeature(actor: ToolActor, feature: FeatureId, access: 'read' | 'write'): Promise<ToolAuthorization> {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) throw await mediaError('unauthorized', 'Sign in with an active account to continue.');
  const [entitlements, permissions, membership] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
    prisma.membership.findFirst({ where: { userId: actor.userId, workspaceId: actor.workspaceId }, select: { role: true } }),
  ]);
  if (!membership || !entitlements || !permissions || !canUseFeature(entitlements, feature) || !canAccessFeature(permissions, feature, access)) {
    throw await mediaError('forbidden', 'This feature is unavailable in this workspace.');
  }
  await assertWorkspaceNotPurging(actor.workspaceId);
  const currentGrants = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowed = actor.allowedTargetIds === undefined ? currentGrants : actor.allowedTargetIds.filter(id => currentGrants === undefined || currentGrants.includes(id));
  return { actor: { userId: actor.userId, workspaceId: actor.workspaceId, ...(allowed === undefined ? {} : { allowedTargetIds: allowed }) }, role: membership.role, permissions, entitlements, workspaceWide: Boolean(permissions.pageScope.all) && allowed === undefined };
}
