import { prisma } from './prisma';
import { env } from './env';
import { encryptSecret, decryptSecret } from './crypto';
import { asGraphError } from './facebook/graph';
import { fetchGroups, fetchPages, fetchProfile, debugToken, type AccessToken } from './facebook/oauth';
import { logActivity } from './scheduler/runner';

/**
 * Connecting Facebook accounts and keeping the list of destinations current.
 *
 * A "sync" is idempotent by design: it upserts every Page and Group the user
 * can reach and marks anything that disappeared as unpublishable, rather than
 * deleting it. Deleting would cascade to scheduled posts and quietly drop
 * them; keeping the row lets the UI say "you lost access to this Page" and
 * preserves the history of what was already published there.
 */

export interface SyncSummary {
  pages: number;
  groups: number;
  removed: number;
  warnings: string[];
}

export async function connectAccount(options: {
  workspaceId: string;
  userId: string;
  token: AccessToken;
}): Promise<{ socialAccountId: string; sync: SyncSummary }> {
  const profile = await fetchProfile(options.token.token);

  // Reconnecting the same Facebook user updates the existing row so scheduled
  // posts keep working instead of pointing at an orphaned account.
  const account = await prisma.socialAccount.upsert({
    where: {
      workspaceId_provider_providerUserId: {
        workspaceId: options.workspaceId,
        provider: 'facebook',
        providerUserId: profile.id,
      },
    },
    create: {
      workspaceId: options.workspaceId,
      provider: 'facebook',
      providerUserId: profile.id,
      name: profile.name,
      pictureUrl: profile.pictureUrl,
      accessToken: encryptSecret(options.token.token),
      tokenExpiresAt: options.token.expiresAt,
      scopes: env.facebookScopes.join(','),
      invalidatedAt: null,
      invalidReason: null,
    },
    update: {
      name: profile.name,
      pictureUrl: profile.pictureUrl,
      accessToken: encryptSecret(options.token.token),
      tokenExpiresAt: options.token.expiresAt,
      scopes: env.facebookScopes.join(','),
      invalidatedAt: null,
      invalidReason: null,
    },
  });

  const sync = await syncAccountTargets(account.id);

  await logActivity(
    options.workspaceId,
    'account.connected',
    { accountId: account.id, name: profile.name, ...sync },
    options.userId,
  );

  return { socialAccountId: account.id, sync };
}

export async function syncAccountTargets(socialAccountId: string): Promise<SyncSummary> {
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: socialAccountId } });
  const userToken = decryptSecret(account.accessToken);
  const warnings: string[] = [];

  const pages = await fetchPages(userToken);
  const groups = env.groupsEnabled ? await fetchGroups(userToken) : [];

  if (env.groupsEnabled && groups.length === 0) {
    warnings.push(
      'No Facebook Groups were returned. Since April 2024 a Group only appears here if this app has been added to it by a Group admin.',
    );
  }

  const seen: string[] = [];

  for (const page of pages) {
    // CREATE_CONTENT is the task that actually permits publishing; without it
    // the token will read fine and fail at post time.
    const canPublish = page.tasks.length === 0 || page.tasks.includes('CREATE_CONTENT');

    await prisma.target.upsert({
      where: {
        workspaceId_providerId: { workspaceId: account.workspaceId, providerId: page.id },
      },
      create: {
        workspaceId: account.workspaceId,
        socialAccountId: account.id,
        type: 'page',
        providerId: page.id,
        name: page.name,
        pictureUrl: page.pictureUrl,
        category: page.category,
        accessToken: encryptSecret(page.accessToken),
        canPublish,
        publishBlocker: canPublish ? null : 'Your Facebook role on this Page does not allow creating posts.',
        lastSyncedAt: new Date(),
      },
      update: {
        socialAccountId: account.id,
        name: page.name,
        pictureUrl: page.pictureUrl,
        category: page.category,
        accessToken: encryptSecret(page.accessToken),
        canPublish,
        publishBlocker: canPublish ? null : 'Your Facebook role on this Page does not allow creating posts.',
        lastSyncedAt: new Date(),
      },
    });
    seen.push(page.id);
  }

  for (const group of groups) {
    await prisma.target.upsert({
      where: {
        workspaceId_providerId: { workspaceId: account.workspaceId, providerId: group.id },
      },
      create: {
        workspaceId: account.workspaceId,
        socialAccountId: account.id,
        type: 'group',
        providerId: group.id,
        name: group.name,
        pictureUrl: group.pictureUrl,
        canPublish: group.appInstalled,
        publishBlocker: group.appInstalled ? null : 'Add this app to the Group before publishing to it.',
        lastSyncedAt: new Date(),
      },
      update: {
        socialAccountId: account.id,
        name: group.name,
        pictureUrl: group.pictureUrl,
        canPublish: group.appInstalled,
        publishBlocker: group.appInstalled ? null : 'Add this app to the Group before publishing to it.',
        lastSyncedAt: new Date(),
      },
    });
    seen.push(group.id);
  }

  // Anything previously synced but missing now: access was removed on
  // Facebook's side. Keep the row, block publishing, explain why.
  const { count: removed } = await prisma.target.updateMany({
    where: { socialAccountId: account.id, providerId: { notIn: seen.length > 0 ? seen : ['__none__'] } },
    data: {
      canPublish: false,
      publishBlocker: 'This destination is no longer accessible with the connected Facebook account.',
    },
  });

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: { lastSyncedAt: new Date(), invalidatedAt: null, invalidReason: null },
  });

  return { pages: pages.length, groups: groups.length, removed, warnings };
}

export interface AccountHealth {
  valid: boolean;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  grantedScopes: string[];
  missingScopes: string[];
  message: string | null;
}

/**
 * Check a connection against Facebook rather than against our own records, so
 * the Connections page can warn before a scheduled post fails.
 *
 * The workspace is required rather than optional. This reads a token and can
 * mark an account dead, and an unscoped version was safe only for as long as
 * every caller remembered to check ownership first — which is exactly the
 * assumption that made `disconnect` report success for another tenant's
 * account.
 */
export async function checkAccountHealth(
  socialAccountId: string,
  workspaceId: string,
): Promise<AccountHealth | null> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: socialAccountId, workspaceId },
  });
  if (!account) return null;

  try {
    const info = await debugToken(decryptSecret(account.accessToken));
    const required = env.facebookScopes;
    const missing = required.filter((scope) => !info.scopes.includes(scope));

    if (!info.isValid) {
      await prisma.socialAccount.update({
        where: { id: socialAccountId },
        data: { invalidatedAt: new Date(), invalidReason: 'Facebook reports this token as invalid.' },
      });
    }

    return {
      valid: info.isValid,
      expiresAt: info.expiresAt,
      dataAccessExpiresAt: info.dataAccessExpiresAt,
      grantedScopes: info.scopes,
      missingScopes: missing,
      message: !info.isValid
        ? 'This connection has expired. Reconnect to keep scheduled posts running.'
        : missing.length > 0
          ? `Missing permissions: ${missing.join(', ')}. Reconnect and accept them.`
          : null,
    };
  } catch (error) {
    const graphError = asGraphError(error);
    return {
      valid: false,
      expiresAt: null,
      dataAccessExpiresAt: null,
      grantedScopes: [],
      missingScopes: [],
      message: graphError.displayMessage,
    };
  }
}

/**
 * Mark every connection for a Facebook user as invalid. Called by the
 * deauthorize webhook, which fires when someone removes the app from their
 * Facebook settings — at that point every stored token is already dead.
 */
export async function invalidateAccountsForFacebookUser(providerUserId: string, reason: string): Promise<number> {
  const { count } = await prisma.socialAccount.updateMany({
    where: { provider: 'facebook', providerUserId },
    data: { invalidatedAt: new Date(), invalidReason: reason },
  });
  return count;
}

/**
 * Disconnect an account: destroy every credential it owns, but keep the
 * destinations and their published-post history.
 *
 * Order matters. Page tokens live on the Target rows and stay valid after the
 * account row disappears, so they are wiped first; only then is the account
 * deleted, at which point Target.socialAccountId is set to null by the
 * database. Anything still queued for those destinations is cancelled, since
 * it can no longer be published.
 */
export async function disconnectAccount(workspaceId: string, socialAccountId: string): Promise<void> {
  const targets = await prisma.target.findMany({
    where: { socialAccountId, workspaceId },
    select: { id: true },
  });
  const targetIds = targets.map((target) => target.id);

  await prisma.$transaction([
    prisma.target.updateMany({
      where: { id: { in: targetIds } },
      data: {
        accessToken: null,
        enabled: false,
        canPublish: false,
        publishBlocker: 'The Facebook account for this destination was disconnected.',
      },
    }),
    prisma.postTarget.updateMany({
      where: { targetId: { in: targetIds }, status: { in: ['pending', 'processing'] } },
      data: {
        status: 'cancelled',
        nextAttemptAt: null,
        errorMessage: 'Cancelled because the Facebook account was disconnected.',
      },
    }),
    prisma.socialAccount.deleteMany({ where: { id: socialAccountId, workspaceId } }),
  ]);

  await logActivity(workspaceId, 'account.disconnected', { socialAccountId, targets: targetIds.length });
}
