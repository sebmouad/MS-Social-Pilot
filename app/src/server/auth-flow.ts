import { cookies } from 'next/headers';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { verifyPassword, hashSessionToken, SESSION_COOKIE } from './auth';
import { prisma } from './data';
import { runtimeConfig } from './config/store';
import { needsTwoStepEnrollment } from './auth-policy';

const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
let dummyPasswordHash: string | null = null;

function getDummyPasswordHash() {
  if (!dummyPasswordHash) {
    const salt = randomBytes(16);
    const digest = scryptSync(randomBytes(24), salt, 64, { N: 16_384 });
    dummyPasswordHash = `scrypt:16384:${salt.toString('base64url')}:${digest.toString('base64url')}`;
  }
  return dummyPasswordHash;
}

function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Root-managed sign-in limits use validated registry values. */
export async function authRateLimit() {
  const [attempts, windowMinutes] = await Promise.all([
    runtimeConfig('auth.loginAttempts'),
    runtimeConfig('auth.loginWindowMinutes'),
  ]);
  return {
    limit: attempts,
    windowMs: windowMinutes * 60_000,
  };
}

/** Password login accepts existing stored hashes without migration or rewriting. */
export async function signIn(email: string, password: string): Promise<'signed-in' | 'verify' | 'enroll'> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, passwordHash: true, disabledAt: true, isInstanceOwner: true, totpEnabledAt: true, _count: { select: { passkeys: true } } },
  });
  const valid = verifyPassword(password, user?.passwordHash ?? getDummyPasswordHash());
  if (!user || !valid || user.disabledAt) throw new Error('Invalid email or password.');

  // Config registry validates the policy and supplies its default.
  // Enrolled factors still require verification even when policy is off.
  const policy = await runtimeConfig('security.twoStep');
  const hasTotp = Boolean(user.totpEnabledAt);
  const hasPasskey = user._count.passkeys > 0;
  const privilegedMembership = policy === 'admins' && !user.isInstanceOwner ? await prisma.membership.findFirst({
    where: { userId: user.id, role: { in: ['owner', 'admin'] } },
    select: { role: true },
  }) : null;
  const [sessionDays, pendingMinutes, passkeyOrigin] = await Promise.all([
    runtimeConfig('auth.sessionDays') as Promise<number>,
    runtimeConfig('auth.pendingMinutes') as Promise<number>,
    hasPasskey ? runtimeConfig('auth.passkeyOrigin') as Promise<string> : Promise.resolve(''),
  ]);
  const next = hasTotp || (hasPasskey && Boolean(passkeyOrigin)) ? 'verify'
    : hasPasskey || needsTwoStepEnrollment(policy, user.isInstanceOwner, privilegedMembership ? [privilegedMembership.role] : []) ? 'enroll' : null;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (next ? pendingMinutes * 60 * 1000 : sessionDays * 24 * 60 * 60 * 1000));
  await prisma.session.create({ data: { id: randomBytes(18).toString('base64url'), userId: user.id, tokenHash: hashToken(token), expiresAt, pending: next, challenge: null } });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...cookieOptions, maxAge: next ? pendingMinutes * 60 : sessionDays * 24 * 60 * 60 });
  return next ?? 'signed-in';
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const tokenHash = token ? hashSessionToken(token) : null;
  try {
    if (tokenHash) await prisma.session.deleteMany({ where: { tokenHash } });
  } finally {
    store.set(SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0, expires: new Date(0) });
  }
}
