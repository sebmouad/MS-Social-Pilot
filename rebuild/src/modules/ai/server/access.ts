import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature, type ScopedPermissions } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';

export type AiActor = {
  userId: string; workspaceId: string;
  /** Deny-only key ceiling (MCP); a ceiling can never widen what the member holds now. */
  permissionCeiling?: ScopedPermissions;
};

/**
 * Rebuild authorization from the database on every call: active account and membership, the
 * feature entitlement, the member's current read/write grant and any key ceiling. AI assist has
 * no access of its own; it is available exactly where the member may use the feature it serves
 * (composer: write on Posts; report recap: write on Reports).
 */
export async function authorizeAi(actor: AiActor, feature: string, access: 'read' | 'write' = 'write') {
  const rows = await prisma.$queryRaw<Array<{ role: string; suspendedAt: Date | null }>>`SELECT m.role::text AS role, w."suspendedAt" FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${actor.userId} AND u."disabledAt" IS NULL`;
  const row = rows[0];
  const denied = () => new OperationError('forbidden', 'AI writing assist is unavailable for your role in this workspace.');
  if (!row) throw denied();
  if (row.suspendedAt) throw new OperationError('forbidden', 'This workspace is suspended.');
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || !permissions || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, feature)
    || !canAccessFeature(permissions, feature, access) || (actor.permissionCeiling && !canAccessFeature(actor.permissionCeiling, feature, access))) throw denied();
  await assertWorkspaceNotPurging(actor.workspaceId);
  return { role: row.role };
}
