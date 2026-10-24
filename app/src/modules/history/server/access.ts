import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { canUseFeature, canUseModule, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { HISTORY_FEATURE_ID, HISTORY_READ_ROLES, type HistoryActor } from '../semantics';

export type HistoryAccess = { role: string; timeZone: string };

const denied = () => new OperationError('forbidden', 'History is available to workspace owners and admins.');

/**
 * Rebuild authorization from the database on every call: active account and membership, owner/admin role, the Settings module
 * and History feature entitlement, the feature's read permission (narrowed by any key ceiling) and workspace state. Pages, REST and
 * MCP all call the services, which call this; hiding a control is never the check.
 */
export async function authorizeHistory(actor: HistoryActor): Promise<HistoryAccess> {
  const rows = await prisma.$queryRaw<Array<{ role: string; timezone: string }>>`
    SELECT m.role::text AS role, w.timezone FROM memberships m
    JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId"
    WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${actor.userId} AND u."disabledAt" IS NULL`;
  const row = rows[0];
  if (!row || !HISTORY_READ_ROLES.includes(row.role)) throw denied();
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || !permissions || entitlements.workspaceId !== actor.workspaceId
    || !canUseModule(entitlements, 'settings') || !canUseFeature(entitlements, HISTORY_FEATURE_ID)
    || !canAccessFeature(permissions, HISTORY_FEATURE_ID, 'read')
    || (actor.permissionCeiling && !canAccessFeature(actor.permissionCeiling, HISTORY_FEATURE_ID, 'read'))) throw denied();
  await assertWorkspaceNotPurging(actor.workspaceId);
  return { role: row.role, timeZone: row.timezone };
}
