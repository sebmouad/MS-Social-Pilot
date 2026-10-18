import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { canUseFeature, canUseModule, loadEntitlements, entitledPlatformIds } from '@/server/entitlements';
import { canAccessFeature, resolvePermissions, type ScopedPermissions } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { AREA_FEATURE, PUBLISHING_FEATURES, SHARING_MANAGER_ROLES, SHARING_MODULE_ID, type SharingArea } from '../semantics';
import type { SharingActor } from '../contracts';
import type { SharingLimits } from '../config';

export type Tx = Prisma.TransactionClient;
export type SharingAuthorization = { actor: SharingActor; area: SharingArea; role: string; scope: readonly string[] | null; providers: readonly string[]; canApprove: boolean; /** Publishing features the actor can currently read (entitled, granted, within any key ceiling). */ publishing: readonly string[] };

export const bad = (message = 'Choose valid sharing details and confirm the exact action.') => new OperationError('invalid_request', message);
export const missing = () => new OperationError('not_found', 'This item is unavailable in the current workspace.');
export const unavailable = () => new OperationError('unavailable', 'Sharing is temporarily unavailable. Try again later.');
export const exact = (actual: string, expected: string) => { if (actual !== expected) throw bad(); };

/** A feature is allowed only when current grants and any key ceiling both allow it. */
function allowed(permissions: ScopedPermissions, ceiling: ScopedPermissions | undefined, feature: string, mode: 'read' | 'write') {
  return canAccessFeature(permissions, feature, mode) && (!ceiling || canAccessFeature(ceiling, feature, mode));
}
/** Current channel grants narrowed by an optional key ceiling. null = every channel. A ceiling never widens. */
export function effectiveScope(grants: ScopedPermissions['pageScope'], ceiling: readonly string[] | undefined): readonly string[] | null {
  const current = grants.all ? null : grants.ids;
  if (ceiling === undefined) return current;
  return current === null ? [...ceiling] : ceiling.filter(id => current.includes(id));
}

/**
 * Owner-side authority, rebuilt from the database on every call: active account and membership as owner/admin,
 * the Settings module and the area's own feature (Client sharing or Bio page) in the plan, that feature's
 * read/write permission (narrowed by any key ceiling), workspace not suspended for writes, and no erasure
 * in progress. Public visitors never pass through here. Hiding a control is never the check.
 */
export async function authorizeSharing(actor: SharingActor, area: SharingArea, access: 'read' | 'write'): Promise<SharingAuthorization> {
  if (!actor?.userId || !actor.workspaceId) throw new OperationError('unauthorized', 'Sign in with an active workspace account.');
  const feature = AREA_FEATURE[area];
  const rows = await prisma.$queryRaw<Array<{ role: string; suspendedAt: Date | null }>>`SELECT m.role::text AS role, w."suspendedAt" FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} AND u."disabledAt" IS NULL`;
  const row = rows[0];
  if (!row) throw new OperationError('unauthorized', 'Sign in with an active account to manage sharing.');
  if (!SHARING_MANAGER_ROLES.includes(row.role)) throw new OperationError('forbidden', 'Sharing is available to workspace owners and admins.');
  if (row.suspendedAt && access === 'write') throw new OperationError('forbidden', 'This workspace is suspended.');
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions
    || !canUseModule(entitlements, SHARING_MODULE_ID) || !canUseFeature(entitlements, feature)
    || !allowed(permissions, actor.permissionCeiling, feature, access)) {
    throw new OperationError('forbidden', 'Sharing is unavailable in this workspace.');
  }
  await assertWorkspaceNotPurging(actor.workspaceId);
  const approvals = canUseFeature(entitlements, 'publishing/approvals') && allowed(permissions, actor.permissionCeiling, 'publishing/approvals', 'write');
  const publishing = PUBLISHING_FEATURES.filter(f => canUseFeature(entitlements, f) && allowed(permissions, actor.permissionCeiling, f, 'read'));
  const connection = area === 'sharing' ? await selectedResourceConnectionWhere(actor.workspaceId, entitledPlatformIds(entitlements)) : {provider:{in:[] as string[]}};
  return { providers: connection.provider.in, actor, area, role: row.role, scope: effectiveScope(permissions.pageScope, actor.allowedTargetIds), canApprove: approvals, publishing };
}

/**
 * One transaction for every owner mutation: the shared workspace row lock (so erasure and suspension cannot pass
 * while it is open), a per-workspace advisory lock (serialises limits such as "links per workspace"), and the
 * work itself. It deliberately does NOT wrap itself in `withWorkspaceOperation`: that helper holds its own pooled
 * connection, and nesting a second transaction inside it can exhaust the pool under concurrent writes. The host
 * must list the sharing write tools in its service-owned lock bypass set, as for Tasks.
 */
export async function transact<T>(workspaceId: string, limits: SharingLimits, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR SHARE`;
    if (!locked.length) throw new OperationError('unavailable', 'This workspace is unavailable.');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return fn(tx);
  }, { timeout: limits.transactionTimeoutMs!, maxWait: limits.transactionMaxWaitMs! });
}

type LockRow = { role: string; suspendedAt: Date | null; allPages?: boolean | null; memberDisabled?: string[] | null; workspaceDisabled?: string[] | null; clientAccess?: string[] | null };
/**
 * Inside the write transaction, re-read role, account, suspension, purge state and module switches so a change
 * committed after the preflight wins over it. The purge state is read in a fresh statement after the lock.
 */
export async function lockActor(tx: Tx, actor: SharingActor, area: SharingArea, alsoRead: readonly string[] = [], alsoWrite: readonly string[] = []) {
  const rows = await tx.$queryRaw<LockRow[]>`SELECT m.role::text AS role, w."suspendedAt", m."allPages" AS "allPages", COALESCE(m."disabledModules", ARRAY[]::TEXT[]) AS "memberDisabled", COALESCE(w."disabledModules", ARRAY[]::TEXT[]) AS "workspaceDisabled", COALESCE(w."clientAccess", ARRAY[]::TEXT[]) AS "clientAccess" FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} AND u."disabledAt" IS NULL FOR SHARE OF m, u, w`;
  const row = rows[0];
  if (!row || !SHARING_MANAGER_ROLES.includes(row.role)) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  if (row.suspendedAt) throw new OperationError('forbidden', 'This workspace is suspended.');
  const purge = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text FROM workspace_data_purges WHERE "workspaceId" = ${actor.workspaceId}`;
  if (purge[0] && purge[0].status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
  const fresh = resolvePermissions({ role: row.role, allPages: row.allPages === true, workspaceDisabledModules: row.workspaceDisabled ?? [], memberDisabledModules: row.memberDisabled ?? [], clientAccess: row.clientAccess ?? [], pageAccess: [] });
  if (!canAccessFeature(fresh, AREA_FEATURE[area], 'write') || alsoRead.some(f => !canAccessFeature(fresh, f, 'read')) || alsoWrite.some(f => !canAccessFeature(fresh, f, 'write'))) throw new OperationError('forbidden', 'Sharing is unavailable in this workspace.');
}

/**
 * Audit records carry ids and kinds only: never tokens, token hashes or comment bodies. A key-driven change also records
 * the key id and a fixed source marker (placed last so callers cannot spoof them); the key secret is never available here.
 * A failed audit write aborts the change.
 */
export async function audit(tx: Tx, actor: SharingActor, action: string, detail: Record<string, unknown>) {
  const recorded = actor.apiKeyId ? { ...detail, apiKeyId: actor.apiKeyId, authSource: 'api_key' } : detail;
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(recorded)}::jsonb, NOW())`;
  if (count !== 1) throw new OperationError('unavailable', 'The change could not be recorded, so it was not saved.');
}

/** Prisma reports a raw-query unique violation as P2010 with the database code in `meta`, a model write as P2002. */
export function isUnique(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const { code, meta } = error as { code?: unknown; meta?: { code?: unknown; message?: unknown } | null };
  const nested = meta && typeof meta === 'object' ? meta.code : undefined;
  return code === 'P2002' || code === '23505' || nested === '23505' || (code === 'P2010' && typeof meta?.message === 'string' && meta.message.includes('23505'));
}
/** Map unexpected failures to a safe, non-leaking error; typed operation errors pass through. */
export async function protect<T>(operation: Promise<T>, conflict = 'This address is already in use.'): Promise<T> {
  try { return await operation; } catch (error) {
    if (error instanceof OperationError) throw error;
    if (isUnique(error)) throw new OperationError('conflict', conflict);
    throw new OperationError('upstream_failure', 'The sharing operation could not be confirmed. Refresh before trying again.');
  }
}

/** The smaller of a Root page size and an optional key result ceiling. */
export const pageSize = (configured: number, maxItems?: number) => (maxItems !== undefined && Number.isInteger(maxItems) && maxItems >= 1 ? Math.min(configured, maxItems) : configured);
