import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { canUseFeature, canUseModule, entitledPlatformIds, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { FEATURES, type Actor, type Area, type Scope } from '../contracts';
import type { Copy } from '../copy';
import type { Policy } from '../config';
export type Tx = Prisma.TransactionClient;
export const fail = (code: OperationErrorCode, message: string): never => { throw new OperationError(code, message); };
export async function authorize(actor: Actor, area: Area, mode: 'read' | 'write', copy: Copy) {
 if (!actor?.userId || !actor.workspaceId) return fail('unauthorized', copy.denied);
 const rows = await prisma.$queryRaw<Array<{ role: string; suspendedAt: Date | null; timezone: string }>>`SELECT m.role::text AS role, w."suspendedAt", w.timezone FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} AND u."disabledAt" IS NULL`;
 const row = rows[0];
 if (!row) return fail('unauthorized', copy.denied);
 const managers = area === 'dates' || area === 'seasons' || area === 'trends';
 if (mode === 'write' && (row.suspendedAt || !(managers ? ['owner', 'admin'] : ['owner', 'admin', 'editor', ...(area === 'feeds' ? ['contributor'] : [])]).includes(row.role))) return fail('forbidden', copy.denied);
 const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
 const feature = FEATURES[area];
 if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions || !canUseModule(entitlements, area === 'notes' ? 'analytics' : 'publishing') || !canUseFeature(entitlements, feature) || !canAccessFeature(permissions, feature, mode) || actor.permissionCeiling && !canAccessFeature(actor.permissionCeiling, feature, mode)) return fail('forbidden', copy.denied);
 await assertWorkspaceNotPurging(actor.workspaceId);
 let scope: Scope = permissions.pageScope.all ? null : [...permissions.pageScope.ids];
 for (const ceiling of [actor.allowedTargetIds, actor.permissionCeiling?.pageScope.all === false ? actor.permissionCeiling.pageScope.ids : undefined]) {
  if (ceiling !== undefined) scope = scope === null ? [...ceiling] : scope.filter(id => ceiling.includes(id));
 }
 const connection = await selectedResourceConnectionWhere(actor.workspaceId, entitledPlatformIds(entitlements));
 const channels = await prisma.target.findMany({ where: { workspaceId: actor.workspaceId, enabled: true, socialAccount: connection, ...(scope === null ? {} : { id: { in: [...scope] } }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
 return { scope, channels, role: row.role, timeZone: row.timezone, canWrite: !row.suspendedAt && (managers ? ['owner', 'admin'] : ['owner', 'admin', 'editor', ...(area === 'feeds' ? ['contributor'] : [])]).includes(row.role) && canAccessFeature(permissions, feature, 'write') && (!actor.permissionCeiling || canAccessFeature(actor.permissionCeiling, feature, 'write')) };
}
export type Access = Awaited<ReturnType<typeof authorize>>;
export function checkTargets(ids: readonly string[], access: Access, copy: Copy, global = true) {
 if (!ids.length && global && access.scope !== null) return fail('forbidden', copy.denied);
 if (ids.some(id => !access.channels.some(channel => channel.id === id))) return fail('not_found', copy.missing);
 return [...new Set(ids)];
}
/** SQL array representation is parameterized, including the empty set. */
export const array = (ids: readonly string[]) => ids.length ? Prisma.sql`ARRAY[${Prisma.join(ids)}]::text[]` : Prisma.sql`ARRAY[]::text[]`;
export const visibleArray = (column: Prisma.Sql, access: Access) => Prisma.sql`(${column} = ARRAY[]::text[] OR ${column} <@ ${array(access.channels.map(c => c.id))})`;
export async function transact<T>(actor: Actor, area: Area, policy: Policy, copy: Copy, run: (tx: Tx, access: Access) => Promise<T>): Promise<T> {
 return prisma.$transaction(async tx => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT m.id FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} AND u."disabledAt" IS NULL FOR SHARE OF m, u, w`;
  if (!rows.length) return fail('unauthorized', copy.denied);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))::text`;
  const access = await authorize(actor, area, 'write', copy);
  return run(tx, access);
 }, { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs });
}
export async function audit(tx: Tx, actor: Actor, area: Area, operation: string, id: string, copy: Copy) {
 const detail = { area, operation, id, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId, authSource: 'api_key' } : {}) };
 const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'calendarExtras.write', ${JSON.stringify(detail)}::jsonb, NOW())`;
 if (count !== 1) return fail('unavailable', copy.failure);
}
