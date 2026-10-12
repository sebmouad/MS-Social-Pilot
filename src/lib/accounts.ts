import { channelRoom } from './plans';
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
  // Pages past the plan's channels are left out, and said so.
  let room = await channelRoom(account.workspaceId);
  const known = new Set(
    (await prisma.target.findMany({ where: { workspaceId: account.workspaceId }, select: { providerId: true } })).map((row) => row.providerId),
  );
  let skipped = 0;

  for (const page of pages) {
    if (!known.has(page.id)) {
      if (room < 1) {
        skipped++;
        continue;
      }
      room--;
    }
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
        publishBlockerCode: canPublish ? null : 'role',
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
        publishBlockerCode: canPublish ? null : 'role',
        lastSyncedAt: new Date(),
      },
    });
    seen.push(page.id);
  }

  if (skipped > 0) warnings.push(`${skipped} Page(s) were not added: the plan's channel limit is reached.`);

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
        publishBlockerCode: group.appInstalled ? null : 'group_app',
        lastSyncedAt: new Date(),
      },
      update: {
        socialAccountId: account.id,
        name: group.name,
        pictureUrl: group.pictureUrl,
        canPublish: group.appInstalled,
        publishBlocker: group.appInstalled ? null : 'Add this app to the Group before publishing to it.',
        publishBlockerCode: group.appInstalled ? null : 'group_app',
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
      publishBlockerCode: 'inaccessible',
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
export async function disconnectAccount(
  workspaceId: string,
  socialAccountId: string,
): Promise<{ stillScheduledOnFacebook: number }> {
  const targets = await prisma.target.findMany({
    where: { socialAccountId, workspaceId },
    select: { id: true, name: true, accessToken: true },
  });
  const targetIds = targets.map((target) => target.id);

  // Posts Facebook is already holding are the one thing disconnecting cannot
  // stop by forgetting about them: they publish on their own. And this is the
  // last moment anything can be done about it — the tokens that could delete
  // them are wiped below, and the account row goes with them.
  const account = await prisma.socialAccount.findFirst({
    where: { id: socialAccountId, workspaceId },
    select: { accessToken: true },
  });

  const { stopped, stillScheduledOnFacebook } = await stopHandedOffPosts(targets, account?.accessToken ?? null);

  await prisma.$transaction([
    prisma.target.updateMany({
      where: { id: { in: targetIds } },
      data: {
        accessToken: null,
        enabled: false,
        canPublish: false,
        publishBlocker: 'The Facebook account for this destination was disconnected.',
        publishBlockerCode: 'disconnected',
      },
    }),
    prisma.postTarget.updateMany({
      where: { targetId: { in: targetIds }, status: { in: ['pending', 'processing'] } },
      data: {
        status: 'cancelled',
        nextAttemptAt: null,
        errorCode: 'account_disconnected',
        errorMessage: 'Cancelled because the Facebook account was disconnected.',
      },
    }),
    // Only the ones Facebook confirmed it had dropped. A destination still
    // holding a post keeps saying so, because it is still true.
    prisma.postTarget.updateMany({
      where: { id: { in: stopped } },
      data: {
        status: 'cancelled',
        nextAttemptAt: null,
        errorCode: 'account_disconnected',
        errorMessage: 'Cancelled because the Facebook account was disconnected.',
      },
    }),
    prisma.socialAccount.deleteMany({ where: { id: socialAccountId, workspaceId } }),
  ]);

  await logActivity(workspaceId, 'account.disconnected', {
    socialAccountId,
    targets: targetIds.length,
    removedFromFacebook: stopped.length,
    stillScheduledOnFacebook,
  });

  return { stillScheduledOnFacebook };
}

/**
 * Ask Facebook to drop the posts it is holding for these destinations.
 *
 * Shared by disconnecting an account and removing a single Page: both are the
 * last moment anything can be done about those posts, because the tokens that
 * could delete them go with the rows. Returns the post targets Facebook
 * confirmed it dropped, and a count of the ones it will still publish.
 */
async function stopHandedOffPosts(
  targets: Array<{ id: string; accessToken: string | null }>,
  fallbackToken: string | null,
): Promise<{ stopped: string[]; stillScheduledOnFacebook: number }> {
  const handedOff = await prisma.postTarget.findMany({
    where: {
      targetId: { in: targets.map((target) => target.id) },
      status: 'scheduled_remote',
      remotePostId: { not: null },
    },
    select: { id: true, remotePostId: true, targetId: true },
  });

  const tokenByTarget = new Map(targets.map((target) => [target.id, target.accessToken]));
  const stopped: string[] = [];
  let stillScheduledOnFacebook = 0;

  for (const row of handedOff) {
    const encrypted = tokenByTarget.get(row.targetId) ?? fallbackToken;
    if (!encrypted || !row.remotePostId) {
      stillScheduledOnFacebook += 1;
      continue;
    }

    try {
      const { deleteRemotePost } = await import('./facebook/publish');
      await deleteRemotePost(row.remotePostId, decryptSecret(encrypted));
      stopped.push(row.id);
    } catch {
      // Reported rather than swallowed: the post is still going to publish,
      // and after this call nobody has the credentials to try again.
      stillScheduledOnFacebook += 1;
    }
  }

  return { stopped, stillScheduledOnFacebook };
}

/**
 * Remove one Page, Group or profile from the workspace.
 *
 * A delete, not a flag: somebody who added a Page by mistake wants it gone,
 * and switching it off already exists for keeping it. Everything captured for
 * it here (its posts' delivery rows, analytics, comments) goes with it through
 * the schema's cascades; nothing changes on Facebook except the posts it was
 * holding for this Page, which are deleted there first so they do not publish
 * to a Page nobody can see any more. If the Page is still granted to a
 * connected account, reconnecting brings it back.
 */
export async function removeTarget(
  workspaceId: string,
  targetId: string,
  actorId?: string,
): Promise<{ removed: boolean; stillScheduledOnFacebook: number }> {
  const target = await prisma.target.findFirst({
    where: { id: targetId, workspaceId },
    select: { id: true, name: true, type: true, accessToken: true, socialAccount: { select: { accessToken: true } } },
  });
  if (!target) return { removed: false, stillScheduledOnFacebook: 0 };

  const { stillScheduledOnFacebook } = await stopHandedOffPosts(
    [target],
    target.socialAccount?.accessToken ?? null,
  );

  await prisma.target.deleteMany({ where: { id: target.id, workspaceId } });

  await logActivity(
    workspaceId,
    'target.removed',
    { name: target.name, type: target.type, stillScheduledOnFacebook },
    actorId,
  );

  return { removed: true, stillScheduledOnFacebook };
}
