import { WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { env } from './env';
import { errors } from './errors';
import { decryptSecret, encryptSecret, hashToken, randomToken, verifyPassword } from './crypto';
import { matchTotp, newTotpSecret, otpauthUri } from './totp';

/**
 * Two-step sign-in: after the password, a code from an authenticator app, a
 * passkey, or one of ten single-use recovery codes.
 *
 * Who must use it is a setting (`security.twoStep`): by default root and
 * anyone who is owner or admin of a workspace with a connected profile — the
 * accounts that can publish to a client's Pages or change the installation.
 * Everyone else may turn it on.
 *
 * Between the password and the second step the browser holds a *pending*
 * session (`Session.pending`): it signs nobody in (`getAuthContext` ignores
 * it) and only the two-step screens read it. "Remember this device" leaves a
 * second cookie that skips the step on that browser for 30 days.
 */

export type TwoStepPolicy = 'admins' | 'everyone' | 'off';
export type PendingStep = 'verify' | 'enroll';

export const RECOVERY_CODE_COUNT = 10;
export const TRUSTED_DEVICE_DAYS = 30;

export function twoStepPolicy(): TwoStepPolicy {
  const value = env.twoStepPolicy;
  return value === 'everyone' || value === 'off' ? value : 'admins';
}

/** Whether this account must have a second step before it may sign in. */
export async function twoStepRequired(userId: string): Promise<boolean> {
  const policy = twoStepPolicy();
  if (policy === 'off') return false;
  if (policy === 'everyone') return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isInstanceOwner: true } });
  if (user?.isInstanceOwner) return true;
  const admin = await prisma.membership.findFirst({
    where: {
      userId,
      role: { in: [WorkspaceRole.owner, WorkspaceRole.admin] },
      workspace: { targets: { some: {} } },
    },
    select: { id: true },
  });
  return admin !== null;
}

export async function hasSecondFactor(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabledAt: true, _count: { select: { passkeys: true } } },
  });
  return Boolean(user?.totpEnabledAt) || (user?._count.passkeys ?? 0) > 0;
}

/**
 * What a correct password leads to: straight in, the second step, or setting
 * one up first because this account must have one.
 */
export async function nextStepAfterPassword(userId: string, trustedToken: string | null): Promise<PendingStep | null> {
  if (await hasSecondFactor(userId)) {
    if (trustedToken && (await isTrustedDevice(userId, trustedToken))) return null;
    return 'verify';
  }
  return (await twoStepRequired(userId)) ? 'enroll' : null;
}

// --- Recovery codes ----------------------------------------------------------

function recoveryCode(): string {
  // 10 characters from an alphabet without look-alikes, shown as xxxxx-xxxxx.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = Buffer.from(randomToken(16), 'base64url');
  let code = '';
  for (let index = 0; code.length < 10; index += 1) code += alphabet[bytes[index % bytes.length]! % alphabet.length];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

function normaliseRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Ten new codes, replacing any old ones. Shown once; only their hashes are kept. */
export async function newRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashToken(normaliseRecoveryCode(code)) })),
    }),
  ]);
  return codes;
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  return prisma.recoveryCode.count({ where: { userId, usedAt: null } });
}

// --- Authenticator app (TOTP) --------------------------------------------------

/** Start setting up an authenticator app: a new secret, kept aside until a code proves it was scanned. */
export async function beginTotp(userId: string): Promise<{ secret: string; uri: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: encryptSecret(secret) } });
  const issuer = new URL(env.appUrl).hostname;
  return { secret, uri: otpauthUri({ secret, account: user.email, issuer }) };
}

/** Finish: the code must come from the new secret. Returns the recovery codes, shown once. */
export async function confirmTotp(userId: string, code: string): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpPendingSecret) throw errors.twoStepNotStarted();
  const secret = decryptSecret(user.totpPendingSecret);
  const step = matchTotp(secret, code);
  if (step === null) throw errors.twoStepWrongCode();

  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecret: user.totpPendingSecret,
      totpPendingSecret: null,
      totpEnabledAt: new Date(),
      totpLastStep: step,
    },
  });
  // A first second step gets codes; switching phones keeps the ones already printed.
  return (await recoveryCodesLeft(userId)) > 0 && user.totpEnabledAt ? [] : newRecoveryCodes(userId);
}

/**
 * Check a second-step code: six digits from the app, or a recovery code
 * (used up as it is accepted). A code from the app is accepted once only.
 */
export async function checkSecondStepCode(userId: string, code: string): Promise<'totp' | 'recovery'> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const digits = code.replace(/\s/g, '');

  if (/^\d{6}$/.test(digits)) {
    if (!user.totpSecret) throw errors.twoStepWrongCode();
    const step = matchTotp(decryptSecret(user.totpSecret), digits);
    if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) throw errors.twoStepWrongCode();
    // Conditional, so two requests racing with the same code cannot both pass.
    const { count } = await prisma.user.updateMany({
      where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    if (count === 0) throw errors.twoStepWrongCode();
    return 'totp';
  }

  const hash = hashToken(normaliseRecoveryCode(code));
  const { count } = await prisma.recoveryCode.updateMany({
    where: { userId, codeHash: hash, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count === 0) throw errors.twoStepWrongCode();
  return 'recovery';
}

// --- Trusted devices -----------------------------------------------------------

export async function trustDevice(userId: string, label: string | null): Promise<string> {
  const token = randomToken(32);
  await prisma.trustedDevice.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      label: label?.slice(0, 200) ?? null,
      expiresAt: new Date(Date.now() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export async function isTrustedDevice(userId: string, token: string): Promise<boolean> {
  const device = await prisma.trustedDevice.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!device || device.userId !== userId || device.expiresAt < new Date()) return false;
  await prisma.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  return true;
}

// --- Turning it off, and root's reset ------------------------------------------

/** The person's own choice, with their password; refused while the policy requires a second step. */
export async function disableTwoStep(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!verifyPassword(password, user.passwordHash)) throw errors.currentPasswordWrong();
  if (await twoStepRequired(userId)) throw errors.twoStepRequired();
  await clearSecondFactors(userId);
}

/** Everything that makes up the second step, gone: the next sign-in sets it up again if required. */
export async function clearSecondFactors(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.passkey.deleteMany({ where: { userId } }),
    prisma.trustedDevice.deleteMany({ where: { userId } }),
  ]);
}

export async function twoStepStatus(userId: string) {
  const [user, codes, passkeys, devices, required] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true } }),
    recoveryCodesLeft(userId),
    prisma.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    }),
    prisma.trustedDevice.count({ where: { userId, expiresAt: { gt: new Date() } } }),
    twoStepRequired(userId),
  ]);
  return {
    totp: user.totpEnabledAt?.toISOString() ?? null,
    recoveryCodes: codes,
    passkeys: passkeys.map((passkey) => ({
      id: passkey.id,
      name: passkey.name,
      createdAt: passkey.createdAt.toISOString(),
      lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
    })),
    trustedDevices: devices,
    required,
  };
}

