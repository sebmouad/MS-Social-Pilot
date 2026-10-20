import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { FEEDS_BOUNDS } from '../config';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { OperationError } from '@/lib/operation-error';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import type { Entitlements } from '@/server/entitlements';
import type { ScopedPermissions } from '@/server/permissions';
import { FEEDS_FEATURE_ID } from '../manifest';

export type FeedActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] };
export type FeedAuthorization = { actor: FeedActor; role: string; permissions: ScopedPermissions; entitlements: Entitlements; workspaceWide: boolean };

/** Members who may author content (and therefore manage feeds). */
export const AUTHOR_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'editor', 'contributor']);

/**
 * Current-authority check for the feeds feature. Re-reads the account, membership, plan and grants on every
 * call (UI, HTTP API, MCP and the automatic worker alike); hiding a control is never the security boundary.
 */
export async function authorizeFeeds(actor: FeedActor, access: 'read' | 'write'): Promise<FeedAuthorization> {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) throw new OperationError('unauthorized', 'Sign in with an active account to continue.');
  const [entitlements, permissions, membership] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
    prisma.membership.findFirst({ where: { userId: actor.userId, workspaceId: actor.workspaceId }, select: { role: true } }),
  ]);
  if (!membership || !entitlements || !permissions || !canUseFeature(entitlements, FEEDS_FEATURE_ID) || !canAccessFeature(permissions, FEEDS_FEATURE_ID, access)) {
    throw new OperationError('forbidden', 'This feature is unavailable in this workspace.');
  }
  await assertWorkspaceNotPurging(actor.workspaceId);
  const currentGrants = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const allowed = actor.allowedTargetIds === undefined ? currentGrants : actor.allowedTargetIds.filter(id => currentGrants === undefined || currentGrants.includes(id));
  return { actor: { userId: actor.userId, workspaceId: actor.workspaceId, ...(allowed === undefined ? {} : { allowedTargetIds: allowed }) }, role: membership.role, permissions, entitlements, workspaceWide: Boolean(permissions.pageScope.all) && allowed === undefined };
}

/** Write authority: the feature grant plus an authoring role. */
export async function authorizeFeedWrite(actor: FeedActor): Promise<FeedAuthorization> {
  const auth = await authorizeFeeds(actor, 'write');
  if (!AUTHOR_ROLES.has(auth.role)) throw new OperationError('forbidden', 'You do not have permission to manage feeds.');
  return auth;
}

/**
 * The person automatic reads act as: the oldest active workspace owner whose current plan and grants
 * allow writing feeds (the workspace-owner worker policy; grants from different owners are never
 * combined, and `accept` must also pass for the chosen owner, e.g. destination qualification).
 */
export async function qualifyingOwner(workspaceId: string, accept: (actor: FeedActor) => Promise<void> = async () => undefined, requestedLimit?: number): Promise<FeedAuthorization | null> {
  const configuredLimit = requestedLimit ?? await runtimeConfig('feeds.qualifyingOwnerScanLimit');
  const limit = typeof configuredLimit === 'number' && Number.isSafeInteger(configuredLimit) && configuredLimit >= FEEDS_BOUNDS.qualifyingOwnerScanLimit.min && configuredLimit <= FEEDS_BOUNDS.qualifyingOwnerScanLimit.max
    ? configuredLimit : FEEDS_BOUNDS.qualifyingOwnerScanLimit.min;
  const owners = await prisma.$queryRaw<Array<{ userId: string }>>`SELECT m."userId" AS "userId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${workspaceId} AND m.role::text = 'owner' AND u."disabledAt" IS NULL ORDER BY m.id ASC LIMIT ${limit}`;
  for (const owner of owners) {
    try {
      const auth = await authorizeFeedWrite({ userId: owner.userId, workspaceId });
      await accept(auth.actor);
      return auth;
    } catch (error) {
      if (error instanceof OperationError && ['forbidden', 'unauthorized', 'unavailable', 'invalid_request'].includes(error.code)) continue;
      throw error;
    }
  }
  return null;
}
