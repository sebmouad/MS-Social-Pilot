import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { hashSessionToken, SESSION_COOKIE } from './auth';
import { prisma } from './data';
import { decryptSecret, encryptSecret } from './secret-crypto';
import { matchTotp, newTotpSecret, otpauthUri } from './totp';
import type { Prisma } from '../../generated/client';
import { runtimeConfig } from './config/store';
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON, type AuthenticatorTransportFuture } from '@simplewebauthn/server';

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

async function pendingSession(kind: 'verify' | 'enroll') {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const tokenHash = token ? hashSessionToken(token) : null;
  if (!tokenHash) throw new Error('Your sign-in has expired.');
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, pending: true, expiresAt: true, user: { select: { id: true, disabledAt: true } } },
  });
  if (!session || session.pending !== kind || session.expiresAt <= new Date() || session.user.disabledAt || session.user.id !== session.userId) {
    throw new Error('Your sign-in has expired.');
  }
  return session;
}

export async function pendingUserId(kind: 'verify' | 'enroll') {
  return (await pendingSession(kind)).userId;
}

async function passkeyOrigin() {
  const configured = await runtimeConfig('auth.passkeyOrigin') as string;
  if (!configured) throw new Error('Passkey verification is not configured.');
  const origin = new URL(configured);
  if (origin.origin !== configured || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === 'localhost'))) throw new Error('Passkey verification is not configured.');
  return { origin: origin.origin, rpID: origin.hostname };
}

function passkeyChallenge(value: string, now: number, maxAgeMinutes: number) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('The passkey challenge has expired.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The passkey challenge has expired.');
  const { challenge, issuedAt } = parsed as Record<string, unknown>;
  if (typeof challenge !== 'string' || !challenge || typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt > maxAgeMinutes * 60_000) throw new Error('The passkey challenge has expired.');
  return challenge;
}

export async function pendingPasskeyAvailable() {
  const pending = await pendingSession('verify');
  const [count, configured] = await Promise.all([
    prisma.passkey.count({ where: { userId: pending.userId } }),
    runtimeConfig('auth.passkeyOrigin') as Promise<string>,
  ]);
  return count > 0 && Boolean(configured);
}

/** Issue a challenge tied to the password-verified browser session. */
export async function beginPasskeyVerification() {
  const pending = await pendingSession('verify');
  const { rpID } = await passkeyOrigin();
  const passkeys = await prisma.passkey.findMany({ where: { userId: pending.userId }, select: { credentialId: true, transports: true } });
  if (!passkeys.length) throw new Error('No passkey is enrolled for this account.');
  const options = await generateAuthenticationOptions({
    rpID, allowCredentials: passkeys.map(passkey => ({ id: passkey.credentialId, transports: passkey.transports as AuthenticatorTransportFuture[] })),
    userVerification: 'preferred',
  });
  const storedChallenge = JSON.stringify({ challenge: options.challenge, issuedAt: Date.now() });
  const changed = await prisma.session.updateMany({ where: { id: pending.id, pending: 'verify', expiresAt: { gt: new Date() } }, data: { challenge: storedChallenge } });
  if (changed.count !== 1) throw new Error('Your sign-in has expired.');
  return options;
}

/** Consume the challenge once, verify the credential, then complete the session. */
export async function verifyPasskeySecondStep(response: AuthenticationResponseJSON) {
  const pending = await pendingSession('verify');
  const stored = await prisma.session.findUnique({ where: { id: pending.id }, select: { challenge: true } });
  if (!stored?.challenge) throw new Error('The passkey challenge has expired.');
  const maxAgeMinutes = await runtimeConfig('auth.passkeyChallengeMinutes') as number;
  const challenge = passkeyChallenge(stored.challenge, Date.now(), maxAgeMinutes);
  const consumed = await prisma.session.updateMany({
    where: { id: pending.id, pending: 'verify', challenge: stored.challenge, expiresAt: { gt: new Date() } },
    data: { challenge: null },
  });
  if (consumed.count !== 1) throw new Error('The passkey challenge has expired.');
  const passkey = await prisma.passkey.findUnique({ where: { credentialId: response.id } });
  if (!passkey || passkey.userId !== pending.userId) throw new Error('The passkey could not be verified.');
  const { origin, rpID } = await passkeyOrigin();
  const verified = await verifyAuthenticationResponse({
    response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
    credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter, transports: passkey.transports as AuthenticatorTransportFuture[] },
  }).catch(() => null);
  if (!verified?.verified) throw new Error('The passkey could not be verified.');
  const sessionDays = await runtimeConfig('auth.sessionDays') as number;
  await prisma.$transaction(async tx => {
    const changed = await tx.passkey.updateMany({ where: { id: passkey.id, counter: passkey.counter }, data: { counter: verified.authenticationInfo.newCounter, lastUsedAt: new Date() } });
    if (changed.count !== 1) throw new Error('The passkey was already used.');
    await completePending(tx, pending.id, 'verify', sessionDays);
  });
  await extendSessionCookie(sessionDays);
  return 'passkey' as const;
}

async function completePending(tx: Prisma.TransactionClient, sessionId: string, kind: 'verify' | 'enroll', sessionDays: number) {
  const changed = await tx.session.updateMany({
    where: { id: sessionId, pending: kind, expiresAt: { gt: new Date() } },
    data: { pending: null, challenge: null, expiresAt: new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000) },
  });
  if (changed.count !== 1) throw new Error('Your sign-in has expired.');
}

async function extendSessionCookie(sessionDays: number) {
  // The cookie already contains the same token; extend its browser expiry.
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) store.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: sessionDays * 24 * 60 * 60 });
}

function normalizeRecoveryCode(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function generateRecoveryCode() {
  const bytes = randomBytes(10);
  let result = '';
  for (const byte of bytes) result += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  return `${result.slice(0, 5)}-${result.slice(5)}`;
}

export async function beginEnrollment(issuer: string) {
  const pending = await pendingSession('enroll');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: pending.userId }, select: { email: true, totpEnabledAt: true } });
  if (user.totpEnabledAt) throw new Error('An authenticator is already enabled.');
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: pending.userId }, data: { totpPendingSecret: encryptSecret(secret) } });
  return { secret, uri: otpauthUri({ secret, account: user.email, issuer }) };
}

export async function confirmEnrollment(code: string) {
  const pending = await pendingSession('enroll');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: pending.userId }, select: { totpPendingSecret: true, totpEnabledAt: true } });
  if (!user.totpPendingSecret || user.totpEnabledAt) throw new Error('Authenticator setup has expired.');
  const step = matchTotp(decryptSecret(user.totpPendingSecret), code);
  if (step === null) throw new Error('The authenticator code is incorrect.');
  const [sessionDays, recoveryCodeCount] = await Promise.all([
    runtimeConfig('auth.sessionDays') as Promise<number>,
    runtimeConfig('auth.recoveryCodeCount') as Promise<number>,
  ]);
  const codes = Array.from({ length: recoveryCodeCount }, generateRecoveryCode);
  await prisma.$transaction(async tx => {
    const changed = await tx.user.updateMany({
      where: { id: pending.userId, totpEnabledAt: null, totpPendingSecret: user.totpPendingSecret },
      data: { totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step },
    });
    if (changed.count !== 1) throw new Error('Authenticator setup has already completed.');
    await tx.recoveryCode.deleteMany({ where: { userId: pending.userId } });
    await tx.recoveryCode.createMany({ data: codes.map(value => ({ id: randomBytes(18).toString('base64url'), userId: pending.userId, codeHash: createHash('sha256').update(normalizeRecoveryCode(value)).digest('hex'), createdAt: new Date() })) });
    await completePending(tx, pending.id, 'enroll', sessionDays);
  });
  await extendSessionCookie(sessionDays);
  return codes;
}

export async function verifySecondStep(code: string) {
  const pending = await pendingSession('verify');
  const sessionDays = await runtimeConfig('auth.sessionDays') as number;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: pending.userId }, select: { totpSecret: true, totpLastStep: true, totpEnabledAt: true } });
  const digits = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(digits) && user.totpSecret && user.totpEnabledAt) {
    const step = matchTotp(decryptSecret(user.totpSecret), digits);
    if (step !== null) {
      const accepted = await prisma.$transaction(async tx => {
        const changed = await tx.user.updateMany({ where: { id: pending.userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
        if (changed.count !== 1) return false;
        await completePending(tx, pending.id, 'verify', sessionDays);
        return true;
      });
      if (accepted) { await extendSessionCookie(sessionDays); return 'totp' as const; }
    }
  }
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length === 10) {
    const hash = createHash('sha256').update(normalized).digest('hex');
    const accepted = await prisma.$transaction(async tx => {
      const changed = await tx.recoveryCode.updateMany({ where: { userId: pending.userId, codeHash: hash, usedAt: null }, data: { usedAt: new Date() } });
      if (changed.count !== 1) return false;
      await completePending(tx, pending.id, 'verify', sessionDays);
      return true;
    });
    if (accepted) { await extendSessionCookie(sessionDays); return 'recovery' as const; }
  }
  throw new Error('The verification code is incorrect.');
}
