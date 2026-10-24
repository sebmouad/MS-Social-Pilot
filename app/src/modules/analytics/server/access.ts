import { errorCopyDefaults } from '@/modules/analytics/error-copy';
import { analyticsError } from '@/modules/analytics/server/error-copy';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import type { AnalyticsAdCeiling } from './types';

export type Tx = Prisma.TransactionClient;
export type AnalyticsFeature = 'analytics/overview' | 'analytics/reports' | 'analytics/demographics' | 'analytics/pins' | 'analytics/goals' | 'analytics/compare';
export type Actor = { userId: string; workspaceId: string; allowedChannelIds?: readonly string[]; maxResultItems?: number } & AnalyticsAdCeiling;
export type Authorization = { role: string; scope: string[] | null };

export const bad = (message = errorCopyDefaults["Choose valid details and confirm the exact action."].en) => new OperationError('invalid_request', message);
export const missing = () => new OperationError('not_found', errorCopyDefaults["This item is unavailable in the current workspace."].en);
export const unavailable = () => new OperationError('unavailable', errorCopyDefaults["Analytics workflows are temporarily unavailable. Try again later."].en);

/** Active account, membership, plan entitlement, role permission, channel scope; writes also require a workspace that is not being purged. */
export async function authorize(actor: Actor, feature: AnalyticsFeature, access: 'read' | 'write'): Promise<Authorization> {
  if (!actor?.userId || !actor.workspaceId) throw await analyticsError('unauthorized', "Sign in with an active workspace account.");
  const [user, membership, entitlements, permissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!user || user.disabledAt || !membership) throw await analyticsError('unauthorized', "Sign in with an active account to use Analytics.");
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions || !canUseFeature(entitlements, feature) || !canAccessFeature(permissions, feature, access)) {
    throw await analyticsError('forbidden', "This Analytics feature is unavailable in this workspace.");
  }
  if (access === 'write') await assertWorkspaceNotPurging(actor.workspaceId);
  const current = permissions.pageScope.all ? null : [...permissions.pageScope.ids];
  const scope = actor.allowedChannelIds === undefined ? current : actor.allowedChannelIds.filter(id => current === null || current.includes(id));
  return { role: membership.role, scope };
}

/** Re-check, with row locks, that the actor is still active with a role that may write. */
export async function lockActor(tx: Tx, actor: Actor, roles: readonly string[]) {
  const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR SHARE OF m, u`;
  const row = rows[0];
  if (!row || row.disabledAt || !roles.includes(row.role)) throw await analyticsError('unauthorized', "Your active workspace access changed. Sign in again to continue.");
}

/** Audit records hold identifiers and counts only, never recipient addresses. */
export async function audit(tx: Tx, actor: Actor, action: string, detail: Record<string, unknown>) {
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (count !== 1) throw unavailable();
}
export function isUnique(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
  return code === 'P2002' || code === '23505';
}
/** Roles that may change shared report definitions; others read only. */
export const REPORT_WRITE_ROLES = ['owner', 'admin', 'editor'] as const;
