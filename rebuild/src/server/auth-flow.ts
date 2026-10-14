import { cookies } from 'next/headers';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { verifyLegacyPassword, hashLegacySessionToken, LEGACY_SESSION_COOKIE } from './auth';
import { prisma } from './data';

const SESSION_DAYS = 30;
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

/** Password login compatible with legacy accounts; no database migration or hash rewrite. */
export async function signIn(email: string, password: string): Promise<'signed-in' | 'second-factor-required'> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, passwordHash: true, disabledAt: true, isInstanceOwner: true, totpEnabledAt: true, _count: { select: { passkeys: true } } },
  });
  const valid = verifyLegacyPassword(password, user?.passwordHash ?? getDummyPasswordHash());
  if (!user || !valid || user.disabledAt) throw new Error('Invalid email or password.');

  // SECURITY_TWO_STEP mirrors the legacy policy's values. Unknown/missing means
  // the legacy default ('admins'); configured factors always require verification.
  const configuredPolicy = (await prisma.appSetting.findUnique({
    where: { key: 'security.twoStep' }, select: { value: true },
  }))?.value ?? process.env.SECURITY_TWO_STEP;
  const policy = configuredPolicy === 'off' || configuredPolicy === 'everyone' || configuredPolicy === 'admins'
    ? configuredPolicy
    : configuredPolicy === undefined ? 'admins' : 'everyone';
  const hasFactor = Boolean(user.totpEnabledAt) || user._count.passkeys > 0;
  const privileged = user.isInstanceOwner || Boolean(await prisma.membership.findFirst({
    where: { userId: user.id, role: { in: ['owner', 'admin'] }, workspace: { targets: { some: {} } } },
    select: { id: true },
  }));
  if (hasFactor || policy === 'everyone' || (policy === 'admins' && privileged)) {
    return 'second-factor-required';
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { id: randomBytes(18).toString('base64url'), userId: user.id, tokenHash: hashToken(token), expiresAt, pending: null, challenge: null } });
  const store = await cookies();
  store.set(LEGACY_SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_DAYS * 24 * 60 * 60 });
  return 'signed-in';
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(LEGACY_SESSION_COOKIE)?.value;
  const tokenHash = token ? hashLegacySessionToken(token) : null;
  try {
    if (tokenHash) await prisma.session.deleteMany({ where: { tokenHash } });
  } finally {
    store.set(LEGACY_SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0, expires: new Date(0) });
  }
}
