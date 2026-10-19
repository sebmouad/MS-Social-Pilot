import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { canUseFeature, entitledPlatformIds, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature, resolvePermissions, type ScopedPermissions } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import type { ReportActor } from '../contracts';
import type { Tx } from '../../server/access';

export type { Tx };
const FEATURE = 'analytics/reports';

export const bad = (message = 'Choose valid details and confirm the exact action.') => new OperationError('invalid_request', message);
export const missing = () => new OperationError('not_found', 'This item is unavailable in the current workspace.');
export const unavailable = () => new OperationError('unavailable', 'Analytics workflows are temporarily unavailable. Try again later.');
/** Roles that may change shared report definitions; others read only. */
export const REPORT_WRITE_ROLES = ['owner', 'admin', 'editor'] as const;
export const isWriter = (role: string) => (REPORT_WRITE_ROLES as readonly string[]).includes(role);
export function isUnique(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const { code, meta } = error as { code?: unknown; meta?: { code?: unknown; message?: unknown } | null };
  const nested = meta && typeof meta === 'object' ? meta.code : undefined;
  return code === 'P2002' || code === '23505' || nested === '23505' || (code === 'P2010' && typeof meta?.message === 'string' && meta.message.includes('23505'));
}

export type ReportAuthority = {
  role: string;
  /** Current channel grants narrowed by any key ceiling. null = every channel the workspace has; [] = none. Never widened. */
  scope: readonly string[] | null;
  /** Platform modules this person's plan currently entitles AND the installation enables. */
  providers: readonly string[];
  /** May change report definitions: writer role and write permission, inside any key ceiling. */
  canManage: boolean;
  /** Smallest page the key allows (undefined = Root's page size). */
  maxItems: number | undefined;
};

/** A feature is allowed only when current grants and any key ceiling both allow it. */
function allowed(permissions: ScopedPermissions, ceiling: ScopedPermissions | undefined, mode: 'read' | 'write') {
  return canAccessFeature(permissions, FEATURE, mode) && (!ceiling || canAccessFeature(ceiling, FEATURE, mode));
}
/** Current grants narrowed by an optional key ceiling. A ceiling never widens and an empty ceiling is "none". */
export function effectiveScope(grants: ScopedPermissions['pageScope'], ceiling: readonly string[] | undefined): readonly string[] | null {
  const current = grants.all ? null : grants.ids;
  if (ceiling === undefined) return current;
  return current === null ? [...ceiling] : ceiling.filter(id => current.includes(id));
}
export function resultCeiling(actor: Pick<ReportActor, 'maxResultItems'>): number | undefined {
  if (actor.maxResultItems === undefined) return undefined;
  if (!Number.isInteger(actor.maxResultItems) || actor.maxResultItems < 1) throw new OperationError('forbidden', 'This access key cannot list report results.');
  return actor.maxResultItems;
}
/** Bounded page: the smaller of Root's size and the key ceiling. */
export const pageOf = (configured: number, ceiling: number | undefined) => (ceiling === undefined ? configured : Math.min(configured, ceiling));
/**
 * Only a SELECTED-RESOURCE key is refused workspace-wide templates. A session editor with channel scope, and an all-resource key
 * whose channel limits are merely inherited from membership, keep authorized workspace-wide feature parity.
 */
export const workspaceWide = (actor: Pick<ReportActor, 'allowedChannelIds' | 'apiKeyId' | 'resourceRestricted'>) =>
  actor.resourceRestricted === undefined ? !(actor.apiKeyId !== undefined && actor.allowedChannelIds !== undefined) : actor.resourceRestricted !== true;
export function requireWorkspaceWide(actor: ReportActor) {
  if (!workspaceWide(actor)) throw new OperationError('forbidden', 'Report templates are workspace-wide and unavailable to access keys limited to selected channels.');
}

/**
 * Rebuilt from the database on every call: active account, membership, workspace not suspended (writes) or being erased,
 * plan entitlement, role permission narrowed by the key ceiling, current channel grants and enabled+entitled platforms.
 * Hiding a control is never the check.
 */
export async function authorizeReport(actor: ReportActor, access: 'read' | 'write', options: { manager?: boolean } = {}): Promise<ReportAuthority> {
  if (!actor?.userId || !actor.workspaceId) throw new OperationError('unauthorized', 'Sign in with an active workspace account.');
  const maxItems = resultCeiling(actor);
  const rows = await prisma.$queryRaw<Array<{ role: string; suspendedAt: Date | null }>>`SELECT m.role::text AS role, w."suspendedAt" FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} AND u."disabledAt" IS NULL`;
  const row = rows[0];
  if (!row) throw new OperationError('unauthorized', 'Sign in with an active account to use Analytics.');
  if (row.suspendedAt && access === 'write') throw new OperationError('forbidden', 'This workspace is suspended.');
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions || !canUseFeature(entitlements, FEATURE) || !allowed(permissions, actor.permissionCeiling, access)) {
    throw new OperationError('forbidden', 'This Analytics feature is unavailable in this workspace.');
  }
  const canManage = isWriter(row.role) && allowed(permissions, actor.permissionCeiling, 'write');
  if (options.manager && !canManage) throw new OperationError('forbidden', 'Reports are managed by owners, admins and editors.');
  if (access === 'write') await assertWorkspaceNotPurging(actor.workspaceId);
  const providers = (await selectedResourceConnectionWhere(actor.workspaceId, entitledPlatformIds(entitlements))).provider.in;
  return { role: row.role, scope: effectiveScope(permissions.pageScope, actor.allowedChannelIds), providers, canManage, maxItems };
}

type LockRow = { role: string; suspendedAt: Date | null; allPages: boolean | null; memberDisabled: string[] | null; workspaceDisabled: string[] | null; clientAccess: string[] | null; pageIds: string[] | null };
/**
 * Inside the write transaction: re-read account, role, suspension, erasure state, module switches and channel grants with
 * row locks, so a change committed after the preflight wins over it. Returns the fresh channel scope (key ceiling applied).
 */
export async function lockActor(tx: Tx, actor: ReportActor): Promise<{ role: string; scope: readonly string[] | null }> {
  const rows = await tx.$queryRaw<LockRow[]>`SELECT m.role::text AS role, w."suspendedAt", m."allPages" AS "allPages", COALESCE(m."disabledModules", ARRAY[]::TEXT[]) AS "memberDisabled", COALESCE(w."disabledModules", ARRAY[]::TEXT[]) AS "workspaceDisabled", COALESCE(w."clientAccess", ARRAY[]::TEXT[]) AS "clientAccess", COALESCE((SELECT ARRAY_AGG(DISTINCT x."targetId") FROM member_page_access x JOIN targets tg ON tg.id = x."targetId" AND tg."workspaceId" = w.id WHERE x."membershipId" = m.id), ARRAY[]::TEXT[]) AS "pageIds" FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} AND u."disabledAt" IS NULL FOR SHARE OF m, u, w`;
  const row = rows[0];
  if (!row || !isWriter(row.role)) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  if (row.suspendedAt) throw new OperationError('forbidden', 'This workspace is suspended.');
  const purge = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text FROM workspace_data_purges WHERE "workspaceId" = ${actor.workspaceId}`;
  if (purge[0] && purge[0].status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
  const fresh = resolvePermissions({ role: row.role, allPages: row.allPages === true, workspaceDisabledModules: row.workspaceDisabled ?? [], memberDisabledModules: row.memberDisabled ?? [], clientAccess: row.clientAccess ?? [], pageAccess: (row.pageIds ?? []).map(targetId => ({ targetId })) });
  if (!allowed(fresh, actor.permissionCeiling, 'write')) throw new OperationError('forbidden', 'This Analytics feature is unavailable in this workspace.');
  return { role: row.role, scope: effectiveScope(fresh.pageScope, actor.allowedChannelIds) };
}

/**
 * Channels that currently qualify for report content: enabled, same-workspace connection not invalidated, platform enabled and
 * entitled. `ids` null = any in the workspace. `lock` takes shared row locks so a disconnect cannot pass the write in flight.
 */
export async function usableChannelIds(db: Pick<Tx, '$queryRaw'>, workspaceId: string, providers: readonly string[], ids: readonly string[] | null, lock = false): Promise<string[]> {
  if (!providers.length || (ids !== null && !ids.length)) return [];
  const list = [...providers];
  const wanted = [...(ids ?? [])];
  const rows = lock
    ? await db.$queryRaw<Array<{ id: string }>>`SELECT t.id FROM targets t JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE t."workspaceId" = ${workspaceId} AND t.enabled = true AND a."invalidatedAt" IS NULL AND a.provider = ANY(${list}::text[]) AND (${ids === null}::boolean OR t.id = ANY(${wanted}::text[])) ORDER BY t.id ASC FOR SHARE OF t, a`
    : await db.$queryRaw<Array<{ id: string }>>`SELECT t.id FROM targets t JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE t."workspaceId" = ${workspaceId} AND t.enabled = true AND a."invalidatedAt" IS NULL AND a.provider = ANY(${list}::text[]) AND (${ids === null}::boolean OR t.id = ANY(${wanted}::text[])) ORDER BY t.id ASC`;
  return rows.map(r => r.id);
}

/**
 * Audit records carry identifiers and counts only, never addresses. A key-driven change also records the key id and a fixed
 * source marker (last, so callers cannot spoof them). A failed write aborts the change.
 */
export async function audit(tx: Tx, actor: Pick<ReportActor, 'userId' | 'workspaceId' | 'apiKeyId'> | { userId: string | null; workspaceId: string; apiKeyId?: string }, action: string, detail: Record<string, unknown>) {
  const recorded = actor.apiKeyId ? { ...detail, apiKeyId: actor.apiKeyId, authSource: 'api_key' } : detail;
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(recorded)}::jsonb, NOW())`;
  if (count !== 1) throw new OperationError('unavailable', 'The change could not be recorded, so it was not saved.');
}
