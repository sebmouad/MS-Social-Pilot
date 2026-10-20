import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import { canUseFeature, canUseModule, loadEntitlements, resolveEntitlements } from '@/server/entitlements';
import { OperationError } from '@/lib/operation-error';
import { canAccessFeature, type ScopedPermissions } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { AGENCY_GROUPS, AGENCY_MODULE_ID, type AgencyAccess, type AgencyActor, type AgencyGroup, type AgencyWorkspaceState } from '../agency';

export type AdministeredWorkspace = { id: string; name: string; role: 'owner' | 'admin'; suspendedAt: Date | null; timezone: string };
export type Classified = AdministeredWorkspace & { state: AgencyWorkspaceState; access: AgencyAccess };

/** The feature whose permission and entitlement must hold, in that workspace, before a capability group is counted. */
export const GROUP_FEATURES: Record<AgencyGroup, string> = {
  channels: 'settings/connections', publishing: 'publishing/posts', tasks: 'tasks/board', team: 'settings/team',
};
/** Groups that read channel-linked data are withheld from a member whose channel scope is limited. */
const CHANNEL_SCOPED: ReadonlySet<AgencyGroup> = new Set(['channels', 'publishing']);

/** Escapes LIKE wildcards so user text is matched literally; pair with `ESCAPE '!'`. */
export const likePattern = (text: string) => `%${text.replace(/[!%_]/g, match => `!${match}`)}%`;

/**
 * Workspaces this person owns or administers. The membership row is the only way in: a workspace appears
 * solely when the signed-in, enabled user holds owner/admin there. Root rights, workspace names and
 * counts of other workspaces never leak through this query. The optional search runs here, in SQL and with
 * bound parameters, before the cap, so a match is never hidden behind the limit. One extra row detects truncation.
 * The search matches the workspace name only. Client names and emails are never read here: this query runs before
 * the per-workspace team permission and entitlement checks, so matching them would leak who is a client.
 */
export async function administeredWorkspaces(actor: AgencyActor, limit: number, search?: { text: string }): Promise<AdministeredWorkspace[]> {
  const pattern = search?.text ? likePattern(search.text) : null;
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; role: string; suspendedAt: Date | null; timezone: string }>>`
    SELECT w.id, w.name, m.role::text AS role, w."suspendedAt", w.timezone
    FROM memberships m
    JOIN workspaces w ON w.id = m."workspaceId"
    JOIN users u ON u.id = m."userId"
    WHERE m."userId" = ${actor.userId} AND m.role::text IN ('owner', 'admin') AND u."disabledAt" IS NULL
      AND (${pattern}::text IS NULL OR w.name ILIKE ${pattern}::text ESCAPE '!')
    ORDER BY w.name ASC, w.id ASC
    LIMIT ${limit + 1}`;
  return rows.map(row => ({ ...row, role: row.role === 'owner' ? 'owner' as const : 'admin' as const }));
}

function groupAccess(entitlements: Parameters<typeof canUseFeature>[0], permissions: ScopedPermissions): AgencyAccess {
  const entries = AGENCY_GROUPS.map(group => {
    const feature = GROUP_FEATURES[group];
    const allowed = canUseFeature(entitlements, feature) && canAccessFeature(permissions, feature, 'read') && (!CHANNEL_SCOPED.has(group) || permissions.pageScope.all);
    return [group, allowed] as const;
  });
  return Object.fromEntries(entries) as AgencyAccess;
}

/**
 * Current installation policy for the Agency module and the requested Agency feature, read before any scoped
 * read. Mirrors the entitlement loader: a stored value that is not an unencrypted `true` is off, and an
 * unreadable policy fails closed. Root rights never bypass it.
 */
export async function assertInstallationPolicy(featureId: string): Promise<void> {
  let rows: Array<{ key: string; value: unknown; encrypted: boolean }>;
  try {
    rows = await prisma.appSetting.findMany({
      where: { key: { in: [`entitlements.modules.${AGENCY_MODULE_ID}`, `entitlements.features.${featureId}`] } },
      select: { key: true, value: true, encrypted: true },
    });
  } catch { throw new OperationError('unavailable', 'Agency views are currently unavailable.'); }
  if (rows.some(item => !(item.encrypted === false && item.value === true))) throw new OperationError('forbidden', 'Agency is not available for your workspaces.');
}

/**
 * A suspended workspace is still listed (its data stays withheld), but only when Agency is otherwise enabled for
 * this person there: workspace and member switches and the plan are evaluated as if it were not suspended.
 */
async function suspendedStillEntitled(actor: AgencyActor, workspaceId: string, featureId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ workspaceDisabled: string[]; memberDisabled: string[]; planFeatures: string[] | null }>>`
    SELECT w."disabledModules" AS "workspaceDisabled", m."disabledModules" AS "memberDisabled", p.features AS "planFeatures"
    FROM memberships m
    JOIN workspaces w ON w.id = m."workspaceId"
    JOIN users u ON u.id = m."userId"
    LEFT JOIN plans p ON p.id = u."planId"
    WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${workspaceId}
    LIMIT 1`;
  const row = rows[0];
  if (!row) return false;
  const entitlements = resolveEntitlements({
    workspace: { id: workspaceId, disabledModules: row.workspaceDisabled, suspendedAt: null },
    membership: { userId: actor.userId, disabledModules: row.memberDisabled },
    planFeatures: row.planFeatures, isInstanceOwner: false,
  });
  return canUseModule(entitlements, AGENCY_MODULE_ID) && canUseFeature(entitlements, featureId);
}

const NONE: AgencyAccess = { channels: false, publishing: false, tasks: false, team: false };

/**
 * Rechecks, per workspace and at read time, the Agency module and feature entitlement (plan, Root switches,
 * workspace and member switches), whether the workspace is being erased, and, for each capability group,
 * the person's permission and entitlement for the module that owns the data. Everything is evaluated for the
 * person in that workspace, never borrowed from another one and never granted by Root rights. Workspaces without
 * the Agency entitlement are dropped; a group without its own grant is withheld from that workspace.
 * Any failure to evaluate a workspace drops it (fail closed) instead of widening access.
 */
export async function classifyWorkspaces(actor: AgencyActor, rows: readonly AdministeredWorkspace[], featureId: string, concurrency: number): Promise<Classified[]> {
  const out: Classified[] = [];
  for (let start = 0; start < rows.length; start += concurrency) {
    const settled = await Promise.all(rows.slice(start, start + concurrency).map(async (row): Promise<Classified | null> => {
      try {
        if (row.suspendedAt) return await suspendedStillEntitled(actor, row.id, featureId) ? { ...row, state: 'suspended', access: NONE } : null;
        const [entitlements, permissions] = await Promise.all([
          loadEntitlements(actor.userId, row.id, { allowInstallationInspection: false }),
          loadPermissions(actor.userId, row.id),
        ]);
        if (!entitlements || entitlements.workspaceId !== row.id || !permissions || !canUseModule(entitlements, AGENCY_MODULE_ID) || !canUseFeature(entitlements, featureId) || !canAccessFeature(permissions, featureId, 'read')) return null;
        try { await assertWorkspaceNotPurging(row.id); } catch { return { ...row, state: 'deleting', access: NONE }; }
        return { ...row, state: 'available', access: groupAccess(entitlements, permissions) };
      } catch { return null; }
    }));
    for (const item of settled) if (item) out.push(item);
  }
  return out;
}

/** Issuance needs at least one currently usable overview workspace; the key stores none of these grants. */
export async function assertAgencyOverviewCredentialAccess(actor: AgencyActor): Promise<void> {
  await assertInstallationPolicy('agency/overview');
  const limit = await runtimeConfig('agency.workspaceLimit');
  const concurrency = await runtimeConfig('agency.accessConcurrency');
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new OperationError('unavailable', 'Agency access policy is unavailable.');
  const rows = await administeredWorkspaces(actor, limit);
  const items = await classifyWorkspaces(actor, rows.slice(0, limit), 'agency/overview', concurrency);
  if (!items.some(item => item.state === 'available')) throw new OperationError('forbidden', 'A currently available Agency overview workspace is required.');
}
