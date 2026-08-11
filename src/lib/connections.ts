import { WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { canManageAccounts } from './constants';
import { disconnectAccount } from './accounts';

/**
 * Managing what this workspace is connected to.
 *
 * The logic lives here rather than in the route handlers for one reason: it is
 * the permission and tenant boundary for every connection, and a boundary that
 * only exists inside a Next route handler cannot be tested without standing up
 * a request. Handlers stay thin — parse, call, respond.
 *
 * Two rules hold throughout:
 *
 * - **Every lookup is scoped by workspace.** Ids arrive from the client, so an
 *   id belonging to another tenant must resolve to nothing rather than to
 *   someone else's page.
 * - **Not found and not allowed are different answers.** Reporting success for
 *   an id that was never touched is how a bug hides for months.
 */

export type ConnectionOutcome = 'ok' | 'not_found' | 'forbidden' | 'blocked';

export interface ConnectionResult {
  outcome: ConnectionOutcome;
  /** Set when the outcome is `blocked`: why Facebook will not accept this. */
  reason?: string;
}

const OK: ConnectionResult = { outcome: 'ok' };

/** Enable or disable one destination. */
export async function setTargetEnabled(options: {
  workspaceId: string;
  role: WorkspaceRole;
  targetId: string;
  enabled: boolean;
}): Promise<ConnectionResult> {
  if (!canManageAccounts(options.role)) return { outcome: 'forbidden' };

  const target = await prisma.target.findFirst({
    where: { id: options.targetId, workspaceId: options.workspaceId },
  });
  if (!target) return { outcome: 'not_found' };

  // Turning a destination back on when Facebook has already refused it would
  // put failing posts back into the queue. Off is always allowed.
  if (options.enabled && !target.canPublish) {
    return {
      outcome: 'blocked',
      reason: target.publishBlocker ?? 'This destination cannot be published to right now.',
    };
  }

  await prisma.target.update({
    where: { id: target.id },
    data: { enabled: options.enabled },
  });

  return OK;
}

/** The two providers that hang off a connected Facebook user. */
export type LinkedKind = 'instagram' | 'ads';

/** Enable or disable one Instagram or ad account's syncing. */
export async function setLinkedAccountEnabled(options: {
  workspaceId: string;
  role: WorkspaceRole;
  kind: LinkedKind;
  id: string;
  enabled: boolean;
}): Promise<ConnectionResult> {
  if (!canManageAccounts(options.role)) return { outcome: 'forbidden' };

  const where = { id: options.id, workspaceId: options.workspaceId };
  const data = { enabled: options.enabled };

  const updated =
    options.kind === 'instagram'
      ? await prisma.instagramAccount.updateMany({ where, data })
      : await prisma.adAccount.updateMany({ where, data });

  return updated.count > 0 ? OK : { outcome: 'not_found' };
}

/**
 * Forget an Instagram or ad account and everything captured for it.
 *
 * Deliberately a delete rather than a flag: the rows are a cache of what
 * Facebook holds, and discovery re-creates the account on the next pass if it
 * is still linked. Disabling is the way to keep it and stop syncing.
 */
export async function removeLinkedAccount(options: {
  workspaceId: string;
  role: WorkspaceRole;
  kind: LinkedKind;
  id: string;
}): Promise<ConnectionResult> {
  if (!canManageAccounts(options.role)) return { outcome: 'forbidden' };

  const where = { id: options.id, workspaceId: options.workspaceId };

  const removed =
    options.kind === 'instagram'
      ? await prisma.instagramAccount.deleteMany({ where })
      : await prisma.adAccount.deleteMany({ where });

  return removed.count > 0 ? OK : { outcome: 'not_found' };
}

/**
 * Disconnect a Facebook account.
 *
 * Existence is checked first so an id from another workspace answers "not
 * found" rather than reporting a successful disconnection that never happened.
 */
export async function disconnect(options: {
  workspaceId: string;
  role: WorkspaceRole;
  socialAccountId: string;
}): Promise<ConnectionResult> {
  if (!canManageAccounts(options.role)) return { outcome: 'forbidden' };

  const account = await prisma.socialAccount.findFirst({
    where: { id: options.socialAccountId, workspaceId: options.workspaceId },
    select: { id: true },
  });
  if (!account) return { outcome: 'not_found' };

  await disconnectAccount(options.workspaceId, account.id);
  return OK;
}

export interface ConnectionSummary {
  accounts: number;
  /** Accounts whose token Facebook has already rejected. */
  broken: number;
  /** Accounts whose token dies within the warning window. */
  expiring: number;
  pages: number;
  groups: number;
  instagram: number;
  adAccounts: number;
}

/**
 * A count of what is connected and how much of it is in trouble.
 *
 * Used by the dashboard banner, so it is deliberately cheap: counts only, no
 * rows loaded.
 */
export async function summariseConnections(
  workspaceId: string,
  options: { now?: Date; warnWithinDays?: number } = {},
): Promise<ConnectionSummary> {
  const now = options.now ?? new Date();
  const horizon = new Date(now.getTime() + (options.warnWithinDays ?? 7) * 24 * 60 * 60 * 1000);

  const [accounts, broken, expiring, pages, groups, instagram, adAccounts] = await Promise.all([
    prisma.socialAccount.count({ where: { workspaceId } }),
    prisma.socialAccount.count({ where: { workspaceId, invalidatedAt: { not: null } } }),
    prisma.socialAccount.count({
      where: {
        workspaceId,
        invalidatedAt: null,
        tokenExpiresAt: { not: null, gt: now, lte: horizon },
      },
    }),
    prisma.target.count({ where: { workspaceId, type: 'page' } }),
    prisma.target.count({ where: { workspaceId, type: 'group' } }),
    prisma.instagramAccount.count({ where: { workspaceId } }),
    prisma.adAccount.count({ where: { workspaceId } }),
  ]);

  return { accounts, broken, expiring, pages, groups, instagram, adAccounts };
}
