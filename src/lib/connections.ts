import { WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { canManageAccounts } from './constants';
import { disconnectAccount, removeTarget as forgetTarget } from './accounts';
import { assertRoom } from './plans';
import { networkOffered, isNetworkKey } from './networks';
import { hasPlatform } from './plans';
import { env } from './env';
import { enabledProductFeatures } from './product-catalog';
import { subscriberOf } from './plans';
import { ensureSettings } from './settings';

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
  /**
   * Posts Facebook will publish regardless of what was just done here.
   *
   * Set by `disconnect` for the ones it could not delete on the way out —
   * nobody has the credentials to try again after that, so it is a loss. Set
   * by `setTargetEnabled` when a destination is switched off with posts still
   * queued inside Facebook — there it is a warning, because those posts can
   * still be cancelled one at a time while the account is connected.
   *
   * Either way it answers the question the screen would otherwise leave open:
   * why did something appear on a Page I had turned off.
   */
  stillScheduledOnFacebook?: number;
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

  if (options.enabled) {
    await ensureSettings();
    const provider = target.type === 'instagram' ? 'instagram' : target.socialAccountId
      ? (await prisma.socialAccount.findUnique({ where: { id: target.socialAccountId }, select: { provider: true } }))?.provider
      : 'facebook';
    const offered = provider === 'facebook' ||
      (provider === 'instagram' ? env.instagramEnabled && await hasPlatform(options.workspaceId, 'instagram') :
        isNetworkKey(provider ?? '') && await networkOffered(options.workspaceId, provider as Parameters<typeof networkOffered>[1]));
    if (!offered) return { outcome: 'blocked', reason: 'This destination is not available for this workspace.' };
  }

  // Turning a destination back on when Facebook has already refused it would
  // put failing posts back into the queue. Off is always allowed.
  if (options.enabled && !target.canPublish) {
    return {
      outcome: 'blocked',
      reason: target.publishBlocker ?? 'This destination cannot be published to right now.',
    };
  }
  if (options.enabled && !target.enabled && target.type !== 'group') await assertRoom(options.workspaceId, 'channels');
  await prisma.target.update({
    where: { id: target.id },
    data: { enabled: options.enabled },
  });

  // Turning it off stops the queue reaching this destination, but not Facebook
  // publishing what it already holds. Deleting those is deliberately not done
  // here — this is a reversible switch, and flipping it back could not put them
  // back — so the person doing it is told instead.
  if (!options.enabled) {
    const waiting = await prisma.postTarget.count({
      where: { targetId: target.id, status: 'scheduled_remote' },
    });
    if (waiting > 0) return { outcome: 'ok', stillScheduledOnFacebook: waiting };
  }

  return OK;
}

/**
 * Remove one destination from the workspace, for good.
 *
 * The same right as disconnecting an account: admin and above. Scoped by
 * workspace, so another tenant's id answers "not found".
 */
export async function removeTarget(options: {
  workspaceId: string;
  role: WorkspaceRole;
  targetId: string;
  actorId?: string;
  deleteData?: boolean;
}): Promise<ConnectionResult> {
  if (!canManageAccounts(options.role)) return { outcome: 'forbidden' };

  const { removed, stillScheduledOnFacebook } = await forgetTarget(
    options.workspaceId,
    options.targetId,
    options.actorId,
    options.deleteData ?? true,
  );
  if (!removed) return { outcome: 'not_found' };
  return stillScheduledOnFacebook > 0 ? { outcome: 'ok', stillScheduledOnFacebook } : OK;
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
  if (options.enabled) {
    await ensureSettings();
    const offered = options.kind === 'instagram'
      ? env.instagramEnabled && await hasPlatform(options.workspaceId, 'instagram')
      : env.adsEnabled && enabledProductFeatures([], (await subscriberOf(options.workspaceId))?.plan?.features).includes('ads/performance');
    if (!offered) return { outcome: 'blocked', reason: 'This source is not available for this workspace.' };
    const source = options.kind === 'instagram'
      ? await prisma.instagramAccount.findFirst({ where, select: { socialAccountId: true } })
      : await prisma.adAccount.findFirst({ where, select: { socialAccountId: true } });
    if (source && !source.socialAccountId) return { outcome: 'blocked', reason: 'Reconnect the source before enabling it.' };
  }
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
  deleteData?: boolean;
}): Promise<ConnectionResult> {
  if (!canManageAccounts(options.role)) return { outcome: 'forbidden' };

  const where = { id: options.id, workspaceId: options.workspaceId };
  const instagramTarget = options.kind === 'instagram'
    ? await prisma.instagramAccount.findFirst({ where, select: { igUserId: true } })
    : null;
  const target = instagramTarget
    ? await prisma.target.findFirst({ where: { workspaceId: options.workspaceId, type: 'instagram', providerId: instagramTarget.igUserId }, select: { id: true } })
    : null;

  const removed = options.deleteData === false
    ? options.kind === 'instagram'
      ? await prisma.instagramAccount.updateMany({ where, data: { enabled: false, socialAccountId: null, targetId: null } })
      : await prisma.adAccount.updateMany({ where, data: { enabled: false, socialAccountId: null } })
    : options.kind === 'instagram'
      ? await prisma.instagramAccount.deleteMany({ where })
      : await prisma.adAccount.deleteMany({ where });

  if (removed.count > 0 && target) await forgetTarget(options.workspaceId, target.id, undefined, options.deleteData !== false);

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
  deleteData?: boolean;
}): Promise<ConnectionResult> {
  if (!canManageAccounts(options.role)) return { outcome: 'forbidden' };

  const account = await prisma.socialAccount.findFirst({
    where: { id: options.socialAccountId, workspaceId: options.workspaceId },
    select: { id: true },
  });
  if (!account) return { outcome: 'not_found' };

  const { stillScheduledOnFacebook } = await disconnectAccount(options.workspaceId, account.id, options.deleteData ?? false);
  return stillScheduledOnFacebook > 0 ? { outcome: 'ok', stillScheduledOnFacebook } : OK;
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

/** Token warnings for channels the member actually has selected. */
export async function selectedConnectionWarnings(options: {
  workspaceId: string;
  targetIds: string[];
  now?: Date;
  warnWithinDays?: number;
}): Promise<{ broken: Array<{ id: string; name: string; reason: string | null }>; expiring: number }> {
  const now = options.now ?? new Date();
  const horizon = new Date(now.getTime() + (options.warnWithinDays ?? 7) * 24 * 60 * 60 * 1000);
  const accounts = await prisma.socialAccount.findMany({
    where: {
      workspaceId: options.workspaceId,
      OR: [
        { targets: { some: { id: { in: options.targetIds } } } },
        { instagramAccounts: { some: { targetId: { in: options.targetIds } } } },
      ],
    },
    select: { id: true, name: true, invalidatedAt: true, invalidReason: true, tokenExpiresAt: true },
  });
  return {
    broken: accounts.filter((account) => account.invalidatedAt !== null)
      .map((account) => ({ id: account.id, name: account.name, reason: account.invalidReason })),
    expiring: accounts.filter((account) => account.invalidatedAt === null && account.tokenExpiresAt !== null
      && account.tokenExpiresAt > now && account.tokenExpiresAt <= horizon).length,
  };
}
