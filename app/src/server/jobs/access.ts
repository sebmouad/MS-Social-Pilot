import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature, hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import { PAGES, type FeatureId } from '@/lib/product';
import { OperationError } from '@/lib/operation-error';
import { WORKSPACE_JOB_OWNER_LIMIT_SCHEMA, WORKSPACE_JOB_OWNER_POLICY_SCHEMA } from './access-policy';

type WorkspaceJobAccess = { provider: string; anyFeatureOf: readonly FeatureId[] };
const FEATURE_IDS = new Set(PAGES.map(page => page.id));
const unavailable = () => new OperationError('unavailable', 'Automatic synchronization is temporarily unavailable.');
const denied = () => new OperationError('forbidden', 'Automatic synchronization is unavailable for this workspace.');

/** System reads have no fabricated human actor. Qualify current owners without Root inspection. */
export async function assertWorkspaceJobAccess(workspaceId: string, input: WorkspaceJobAccess): Promise<void> {
  if (typeof workspaceId !== 'string' || !workspaceId || !input || typeof input !== 'object' ||
    Object.keys(input).some(key => !['provider', 'anyFeatureOf'].includes(key)) ||
    typeof input.provider !== 'string' || !input.provider || !Array.isArray(input.anyFeatureOf) || !input.anyFeatureOf.length ||
    input.anyFeatureOf.some(feature => !FEATURE_IDS.has(feature))) {
    throw new OperationError('invalid_request', 'Choose an installed synchronization capability.');
  }
  const [rawPolicy, rawLimit] = await Promise.all([
    runtimeConfig('jobs.workspaceOwnerPolicy'), runtimeConfig('jobs.workspaceOwnerLimit'),
  ]);
  const policy = WORKSPACE_JOB_OWNER_POLICY_SCHEMA.safeParse(rawPolicy);
  const limit = WORKSPACE_JOB_OWNER_LIMIT_SCHEMA.safeParse(rawLimit);
  if (!policy.success || !limit.success) throw unavailable();

  // An extra row detects overflow. Never authorize from an arbitrary truncated owner subset.
  const owners = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT m."userId" AS "userId"
    FROM memberships m
    JOIN users u ON u.id = m."userId"
    JOIN workspaces w ON w.id = m."workspaceId"
    WHERE m."workspaceId" = ${workspaceId} AND m.role::text = 'owner' AND u."disabledAt" IS NULL
    ORDER BY m.id ASC LIMIT ${limit.data + 1}
  `;
  if (!owners.length) throw denied();
  if (owners.length > limit.data) throw unavailable();

  // Recheck every time, including after a worker waited/retried. A platform grant
  // from one owner cannot be combined with another owner's feature grant.
  const grants = await Promise.all(owners.map(async owner => {
    const access = await loadEntitlements(owner.userId, workspaceId, { allowInstallationInspection: false });
    return Boolean(access && access.workspaceId === workspaceId && hasPlatformCapability(access, input.provider) &&
      input.anyFeatureOf.some(feature => canUseFeature(access, feature)));
  }));
  if (policy.data === 'any_active_owner' ? !grants.some(Boolean) : !grants.every(Boolean)) throw denied();
}
