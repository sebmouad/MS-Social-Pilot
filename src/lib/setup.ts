import { access, constants, mkdir } from 'node:fs/promises';

import type { WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { canManageInstance } from './constants';
import { env } from './env';
import { settingString } from './settings';

/**
 * What still needs doing before this installation can publish anything.
 *
 * Derived from the database and the settings on every read, never stored. A
 * wizard that remembers which step you reached is wrong the moment anything
 * changes underneath it — someone deletes the last connection, or the Facebook
 * app credentials are rotated — and it cannot be resumed on a different
 * machine. Asking the question fresh costs four counts and is always right.
 *
 * The order is the order things depend on each other: an account to sign in
 * with, an app to authenticate against, a connection made through it, and a
 * destination reached by that connection.
 */

export type StepId = 'account' | 'facebookApp' | 'connect' | 'destination' | 'email';

export interface SetupStep {
  id: StepId;
  done: boolean;
  /** Skippable: the installation publishes without it. */
  optional: boolean;
}

export interface SetupState {
  /** Runtime checks, alongside the configuration steps. */
  checks: SetupCheck[];
  /** No account exists yet, so nobody can sign in to do any of this. */
  firstRun: boolean;
  steps: SetupStep[];
  /** Every required step is done. */
  complete: boolean;
  /** The first thing left to do, or null when there is nothing. */
  nextStep: StepId | null;
}

/**
 * A worker seen more recently than this is treated as running.
 *
 * The worker writes its row every thirty seconds, so this allows four missed
 * beats before the screen calls it stopped — long enough that a restart or a
 * slow publish does not raise a false alarm, short enough to be noticed while
 * somebody is still setting the installation up.
 */
const WORKER_STALE_MS = 2 * 60 * 1000;

export type CheckId =
  | 'sessionSecret'
  | 'encryptionKey'
  | 'appUrl'
  | 'database'
  | 'mediaDir'
  | 'worker';

export interface SetupCheck {
  id: CheckId;
  ok: boolean;
  /** The installation runs without it, but something is degraded. */
  optional: boolean;
  /**
   * One short line naming what was found, never what should be there — the
   * remedy belongs in the translated copy, and this half is the evidence.
   * Never contains a secret: a key is reported by its length, not its value.
   */
  detail?: string;
}

/**
 * What is true of this installation right now, as opposed to what has been
 * configured.
 *
 * The step list above asks whether somebody has done something. These ask
 * whether the machine can actually do its job, which is a different question
 * with different failures: a worker that was never started, an `APP_URL` still
 * pointing at localhost on a public server, a media directory the process
 * cannot write to. Each of them lets an installation look finished and then
 * fail at the first post, hours later, with nothing on screen to connect the
 * two.
 */
export async function readSetupChecks(): Promise<SetupCheck[]> {
  const [database, worker, mediaDir] = await Promise.all([
    checkDatabase(),
    checkWorker(),
    checkMediaDir(),
  ]);

  return [checkSessionSecret(), checkEncryptionKey(), checkAppUrl(), database, mediaDir, worker];
}

function checkSessionSecret(): SetupCheck {
  const secret = env.sessionSecret;
  // Long enough that a signature cannot be brute-forced, and not the example
  // value: a shared secret is no secret.
  const ok = secret.trim().length >= 32;
  return {
    id: 'sessionSecret',
    ok,
    optional: false,
    detail: ok ? undefined : `${secret.trim().length} characters`,
  };
}

function checkEncryptionKey(): SetupCheck {
  let bytes = 0;
  try {
    bytes = Buffer.from(env.encryptionKey, 'base64').length;
  } catch {
    bytes = 0;
  }
  // AES-256-GCM takes no other key length, so anything else fails at the first
  // token rather than here.
  return {
    id: 'encryptionKey',
    ok: bytes === 32,
    optional: false,
    detail: bytes === 32 ? undefined : `${bytes} bytes, not 32`,
  };
}

function checkAppUrl(): SetupCheck {
  let host = '';
  try {
    host = new URL(env.appUrl).hostname;
  } catch {
    return { id: 'appUrl', ok: false, optional: false, detail: 'not a URL' };
  }

  // Facebook rejects a redirect URI that does not match this exactly, and it
  // cannot reach a loopback address at all. In development that is correct and
  // expected, so it is only a warning there.
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const production = process.env.NODE_ENV === 'production';

  return {
    id: 'appUrl',
    ok: !loopback || !production,
    optional: !production,
    detail: env.appUrl,
  };
}

async function checkDatabase(): Promise<SetupCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { id: 'database', ok: true, optional: false };
  } catch (error) {
    return {
      id: 'database',
      ok: false,
      optional: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkMediaDir(): Promise<SetupCheck> {
  try {
    // Created on demand elsewhere, so creating it here is the same act rather
    // than a side effect: what is being tested is whether that can happen.
    await mkdir(env.mediaDir, { recursive: true });
    await access(env.mediaDir, constants.W_OK);
    return { id: 'mediaDir', ok: true, optional: false, detail: env.mediaDir };
  } catch (error) {
    return {
      id: 'mediaDir',
      ok: false,
      optional: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkWorker(): Promise<SetupCheck> {
  const newest = await prisma.workerHeartbeat.findFirst({
    orderBy: { seenAt: 'desc' },
    select: { seenAt: true },
  });

  if (!newest) {
    return { id: 'worker', ok: false, optional: false, detail: 'never started' };
  }

  const age = Date.now() - newest.seenAt.getTime();
  return {
    id: 'worker',
    ok: age < WORKER_STALE_MS,
    optional: false,
    detail: `last seen ${Math.round(age / 1000)}s ago`,
  };
}

/** True while the database holds no accounts at all. */
export async function isFirstRun(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

export async function readSetupState(workspaceId: string | null): Promise<SetupState> {
  const [users, accounts, destinations] = await Promise.all([
    prisma.user.count(),
    workspaceId ? prisma.socialAccount.count({ where: { workspaceId } }) : 0,
    workspaceId
      ? prisma.target.count({ where: { workspaceId, enabled: true, canPublish: true } })
      : 0,
  ]);

  const hasApp = Boolean(
    settingString('facebook.appId').trim() && settingString('facebook.appSecret').trim(),
  );

  const steps: SetupStep[] = [
    { id: 'account', done: users > 0, optional: false },
    { id: 'facebookApp', done: hasApp, optional: false },
    { id: 'connect', done: accounts > 0, optional: false },
    { id: 'destination', done: destinations > 0, optional: false },
    // Publishing works without it; nobody hears about a failure without it,
    // which is why it is on this list at all rather than left to be discovered.
    { id: 'email', done: Boolean(settingString('email.apiKey').trim()), optional: true },
  ];

  const outstanding = steps.filter((step) => !step.optional && !step.done);

  const checks = await readSetupChecks();

  return {
    firstRun: users === 0,
    steps,
    checks,
    // Both halves: a step nobody has done, and a check the machine fails. An
    // installation with every box ticked and no worker running publishes
    // nothing, and calling that complete is how somebody finds out days later.
    complete: outstanding.length === 0 && checks.every((check) => check.ok || check.optional),
    nextStep: steps.find((step) => !step.done)?.id ?? null,
  };
}

/**
 * Who is allowed to see and change setup.
 *
 * Open while no account exists, because requiring a sign-in to create the first
 * account is a deadlock. That exception closes the moment anybody registers —
 * after that this screen shows what the installation is connected to and can
 * write the Facebook app credentials, which is owner business.
 *
 * Pure so it can be tested directly: this one rule is the whole security of the
 * setup screen, and it is worth being able to state it in a test rather than
 * infer it from two route handlers.
 */
export function maySetUp(
  auth: { role: WorkspaceRole } | null,
  firstRun: boolean,
): boolean {
  if (firstRun) return true;
  return auth !== null && canManageInstance(auth.role);
}
