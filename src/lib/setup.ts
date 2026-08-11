import type { WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { canManageInstance } from './constants';
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
  /** No account exists yet, so nobody can sign in to do any of this. */
  firstRun: boolean;
  steps: SetupStep[];
  /** Every required step is done. */
  complete: boolean;
  /** The first thing left to do, or null when there is nothing. */
  nextStep: StepId | null;
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

  return {
    firstRun: users === 0,
    steps,
    complete: outstanding.length === 0,
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
