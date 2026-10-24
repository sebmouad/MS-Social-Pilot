import { copyError, withCustomerCopy } from './copy';
import { prisma } from '@/server/data';
import { canUseFeature, canUseModule, loadEntitlements, type Entitlements } from '@/server/entitlements';
import { canAccessFeature, type ScopedPermissions } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { TASK_READ_ROLES, TASK_WRITE_ROLES, TASKS_FEATURE_ID, TASKS_MODULE_ID } from '../semantics';
import type { TasksActor } from '../tasks';

export type TasksAccess = {
  role: string;
  timeZone: string;
  entitlements: Entitlements;
  permissions: ScopedPermissions;
  /** Channels the actor may use right now: current grants narrowed by the key ceiling. undefined = every channel. */
  targetIds: readonly string[] | undefined;
  /** Deny-only key ceiling carried from the actor; absent for sessions. */
  ceiling: ScopedPermissions | undefined;
  /** True only when role, current grants and any key ceiling all allow Tasks writes. */
  canWrite: boolean;
};

/** A feature is allowed only when current grants and any key ceiling both allow it. */
export function featureAllowed(access: Pick<TasksAccess, 'permissions' | 'ceiling'>, feature: string, mode: 'read' | 'write'): boolean {
  return canAccessFeature(access.permissions, feature, mode) && (!access.ceiling || canAccessFeature(access.ceiling, feature, mode));
}

const denied = () => copyError('forbidden', 'Tasks are unavailable for your role in this workspace.');

/** Current grants narrowed by an MCP key ceiling. A ceiling can never widen what the member holds now. */
export function effectiveTargetIds(grants: ScopedPermissions['pageScope'], ceiling: readonly string[] | undefined): readonly string[] | undefined {
  const current = grants.all ? undefined : grants.ids;
  if (ceiling === undefined) return current;
  return current === undefined ? [...ceiling] : ceiling.filter(id => current.includes(id));
}

/**
 * Rebuild authorization from the database on every call: active account and membership, the Tasks module
 * and feature entitlement, the feature's read/write permission, role, workspace state and channel scope.
 * Entry points (pages, HTTP, MCP) call the services, which call this; hiding a control is never the check.
 */
async function authorizeTasksImpl(actor: TasksActor, mode: 'read' | 'write'): Promise<TasksAccess> {
  const rows = await prisma.$queryRaw<Array<{ role: string; timezone: string; suspendedAt: Date | null }>>`SELECT m.role::text AS role, w.timezone, w."suspendedAt" FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${actor.userId} AND u."disabledAt" IS NULL`;
  const row = rows[0];
  if (!row || !(mode === 'write' ? TASK_WRITE_ROLES : TASK_READ_ROLES).includes(row.role)) throw denied();
  if (row.suspendedAt && mode === 'write') throw copyError('forbidden', 'This workspace is suspended.');
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || !permissions || entitlements.workspaceId !== actor.workspaceId
    || !canUseModule(entitlements, TASKS_MODULE_ID) || !canUseFeature(entitlements, TASKS_FEATURE_ID)
    || !featureAllowed({ permissions, ceiling: actor.permissionCeiling }, TASKS_FEATURE_ID, mode)) throw denied();
  await assertWorkspaceNotPurging(actor.workspaceId);
  const canWrite = TASK_WRITE_ROLES.includes(row.role) && !row.suspendedAt && featureAllowed({ permissions, ceiling: actor.permissionCeiling }, TASKS_FEATURE_ID, 'write');
  return { role: row.role, timeZone: row.timezone, entitlements, permissions, targetIds: effectiveTargetIds(permissions.pageScope, actor.allowedTargetIds), ceiling: actor.permissionCeiling, canWrite };
}

export const authorizeTasks = (...args: Parameters<typeof authorizeTasksImpl>) => withCustomerCopy(() => authorizeTasksImpl(...args));
