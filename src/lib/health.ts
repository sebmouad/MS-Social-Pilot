import { prisma } from './prisma';
import { env } from './env';
import { settingString } from './settings';
import { decryptSecret } from './crypto';
import { asGraphError, graphRequest } from './facebook/graph';
import { debugToken } from './facebook/oauth';
import { readPermissions, type PermissionState } from './facebook/permissions';

/**
 * Does the Facebook connection actually work, and if not, what exactly is wrong.
 *
 * The question this answers is the one people ask after a post fails to go out:
 * *why*. Every part of the answer already exists somewhere in Graph, spread
 * across three endpoints that each tell a fraction of it, and none of which
 * says anything a person can act on. This puts them together and translates.
 *
 * Live calls, so it is never run on a page render — the connections screen
 * shows what is stored and offers a button. A workspace with six Pages costs
 * about ten Graph calls per run.
 */

export type Verdict = 'ok' | 'attention' | 'broken';

export interface AppHealth {
  configured: boolean;
  valid: boolean;
  appId: string | null;
  verdict: Verdict;
  headline: string;
}

export interface DestinationHealth {
  targetId: string;
  name: string;
  type: string;
  enabled: boolean;
  /** Facebook answered for this destination with the token we hold. */
  reachable: boolean;
  canPublish: boolean;
  verdict: Verdict;
  headline: string;
}

export interface AccountHealthReport {
  accountId: string;
  name: string;
  tokenValid: boolean;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  permissions: PermissionState[];
  destinations: DestinationHealth[];
  verdict: Verdict;
  headline: string;
}

export interface WorkspaceHealth {
  checkedAt: Date;
  app: AppHealth;
  accounts: AccountHealthReport[];
}

function worst(verdicts: Verdict[]): Verdict {
  if (verdicts.includes('broken')) return 'broken';
  if (verdicts.includes('attention')) return 'attention';
  return 'ok';
}

/**
 * Is the Meta app itself set up and accepted by Facebook?
 *
 * Worth asking separately, because when this is wrong *every* connection below
 * it reports failure and the screen looks like eight problems instead of one.
 */
export async function checkApp(): Promise<AppHealth> {
  // Read through the settings store rather than `env.facebookAppId`, which
  // throws when unset. Reporting that nothing is configured is exactly what
  // this function is for, so it must survive the case it exists to describe.
  const appId = settingString('facebook.appId').trim() || null;
  const secret = settingString('facebook.appSecret').trim() || null;

  if (!appId || !secret) {
    return {
      configured: false,
      valid: false,
      appId,
      verdict: 'broken',
      headline:
        'No Facebook app is configured. Add the app ID and secret on the Configuration screen before connecting anything.',
    };
  }

  try {
    await graphRequest<{ id?: string }>('app', {
      accessToken: `${appId}|${secret}`,
      params: { fields: 'id' },
    });

    return {
      configured: true,
      valid: true,
      appId,
      verdict: 'ok',
      headline: `Connected to Facebook app ${appId}.`,
    };
  } catch (error) {
    return {
      configured: true,
      valid: false,
      appId,
      verdict: 'broken',
      headline: `Facebook rejected this app's credentials: ${asGraphError(error).displayMessage}`,
    };
  }
}

/** Can we still reach this Page or Group with the token we hold for it? */
async function checkDestination(target: {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  providerId: string;
  canPublish: boolean;
  publishBlocker: string | null;
  accessToken: string | null;
  fallbackToken: string;
  publishScope: string;
  granularScopes: Record<string, string[]>;
}): Promise<DestinationHealth> {
  const base = {
    targetId: target.id,
    name: target.name,
    type: target.type,
    enabled: target.enabled,
  };

  const token = target.accessToken ? decryptSecret(target.accessToken) : target.fallbackToken;

  try {
    await graphRequest<{ id?: string }>(target.providerId, {
      accessToken: token,
      params: { fields: 'id,name' },
    });
  } catch (error) {
    return {
      ...base,
      reachable: false,
      canPublish: false,
      verdict: 'broken',
      headline: `Facebook will not answer for this destination: ${asGraphError(error).displayMessage}`,
    };
  }

  // Granted, but only for some Pages. This is the failure nobody diagnoses
  // unaided: the permission is on the token, so everything looks right, and
  // publishing fails on exactly the Pages that were left unticked.
  const covered = target.granularScopes[target.publishScope];
  if (covered && !covered.includes(target.providerId)) {
    return {
      ...base,
      reachable: true,
      canPublish: false,
      verdict: 'broken',
      headline:
        'Reachable, but publishing was not allowed for this one. Reconnect and tick it in the list of Pages Facebook offers.',
    };
  }

  if (!target.canPublish) {
    return {
      ...base,
      reachable: true,
      canPublish: false,
      verdict: 'broken',
      headline: target.publishBlocker ?? 'This destination cannot be published to.',
    };
  }

  if (!target.enabled) {
    return {
      ...base,
      reachable: true,
      canPublish: true,
      verdict: 'attention',
      headline: 'Working, but turned off here, so scheduled posts skip it.',
    };
  }

  return { ...base, reachable: true, canPublish: true, verdict: 'ok', headline: 'Ready to publish.' };
}

/** Everything about one connected Facebook user. */
export async function checkAccount(
  accountId: string,
  workspaceId: string,
  now: Date = new Date(),
): Promise<AccountHealthReport | null> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: accountId, workspaceId },
    include: { targets: { orderBy: [{ type: 'asc' }, { name: 'asc' }] } },
  });
  if (!account) return null;

  const userToken = decryptSecret(account.accessToken);
  const base = {
    accountId: account.id,
    name: account.name,
    permissions: [] as PermissionState[],
    destinations: [] as DestinationHealth[],
  };

  let info;
  try {
    info = await debugToken(userToken);
  } catch (error) {
    return {
      ...base,
      tokenValid: false,
      expiresAt: null,
      dataAccessExpiresAt: null,
      verdict: 'broken',
      headline: `Facebook could not check this connection: ${asGraphError(error).displayMessage}`,
    };
  }

  if (!info.isValid) {
    // Record it, so the rest of the app stops trying rather than discovering
    // this again at publish time.
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { invalidatedAt: now, invalidReason: 'Facebook reports this connection as expired.' },
    });

    return {
      ...base,
      tokenValid: false,
      expiresAt: info.expiresAt,
      dataAccessExpiresAt: info.dataAccessExpiresAt,
      verdict: 'broken',
      headline: 'This connection has expired. Reconnect to start publishing again.',
    };
  }

  const permissions = await readPermissions(userToken, env.facebookScopes).catch(() => []);

  const destinations = await Promise.all(
    account.targets.map((target) =>
      checkDestination({
        id: target.id,
        name: target.name,
        type: target.type,
        enabled: target.enabled,
        providerId: target.providerId,
        canPublish: target.canPublish,
        publishBlocker: target.publishBlocker,
        accessToken: target.accessToken,
        fallbackToken: userToken,
        publishScope: target.type === 'group' ? 'publish_to_groups' : 'pages_manage_posts',
        granularScopes: info.granularScopes,
      }),
    ),
  );

  const missing = permissions.filter((state) => state.required && state.status !== 'granted');
  const expiringSoon =
    info.expiresAt !== null &&
    info.expiresAt.getTime() - now.getTime() < env.tokenWarningDays * 24 * 60 * 60 * 1000;

  const verdict = worst([
    missing.length > 0 ? 'broken' : 'ok',
    expiringSoon ? 'attention' : 'ok',
    ...destinations.map((destination) => destination.verdict),
  ]);

  const headline =
    missing.length > 0
      ? `Missing ${missing.length === 1 ? 'a permission' : `${missing.length} permissions`}: ${missing
          .map((state) => state.label.toLowerCase())
          .join(', ')}. Reconnect and accept them.`
      : expiringSoon
        ? 'Working, but this connection expires soon. Reconnect to avoid an interruption.'
        : destinations.some((destination) => destination.verdict === 'broken')
          ? 'Connected, but some destinations below need attention.'
          : 'Everything is working.';

  return {
    ...base,
    tokenValid: true,
    expiresAt: info.expiresAt,
    dataAccessExpiresAt: info.dataAccessExpiresAt,
    permissions,
    destinations,
    verdict,
    headline,
  };
}

/** The whole picture, for the button on the connections screen. */
export async function checkWorkspace(
  workspaceId: string,
  now: Date = new Date(),
): Promise<WorkspaceHealth> {
  const app = await checkApp();

  const accounts = await prisma.socialAccount.findMany({
    where: { workspaceId },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  // Nothing below the app can work if the app itself does not, and running the
  // checks anyway would report every connection as broken for one reason.
  if (!app.valid) return { checkedAt: now, app, accounts: [] };

  const reports = await Promise.all(
    accounts.map((account) => checkAccount(account.id, workspaceId, now)),
  );

  return {
    checkedAt: now,
    app,
    accounts: reports.filter((report): report is AccountHealthReport => report !== null),
  };
}
