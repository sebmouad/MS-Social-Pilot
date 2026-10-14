import { cookies } from 'next/headers';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { verifyLegacyPassword, hashLegacySessionToken, LEGACY_SESSION_COOKIE } from './auth';
import { prisma } from './data';

const SESSION_DAYS = 30;
const PENDING_MINUTES = 15;
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

/** Root-managed limits retain the existing environment fallbacks. */
export async function authRateLimit() {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: ['auth.loginAttempts', 'auth.loginWindowMinutes'] } }, select: { key: true, value: true } });
  const values = new Map(rows.map(row => [row.key, row.value]));
  const safeInteger = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  const envAttempts = safeInteger(Number(process.env.LOGIN_ATTEMPTS), 10, 1, 1000);
  const envWindow = safeInteger(Number(process.env.LOGIN_WINDOW_MINUTES), 15, 1, 1440);
  return {
    limit: safeInteger(values.get('auth.loginAttempts'), envAttempts, 1, 1000),
    windowMs: safeInteger(values.get('auth.loginWindowMinutes'), envWindow, 1, 1440) * 60_000,
  };
}

/** Password login compatible with legacy accounts; no database migration or hash rewrite. */
export async function signIn(email: string, password: string): Promise<'signed-in' | 'verify' | 'enroll'> {
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
  const hasTotp = Boolean(user.totpEnabledAt);
  const hasPasskey = user._count.passkeys > 0;
  const privileged = user.isInstanceOwner || Boolean(await prisma.membership.findFirst({
    where: { userId: user.id, role: { in: ['owner', 'admin'] }, workspace: { targets: { some: {} } } },
    select: { id: true },
  }));
  // Passkey verification is not yet supported by this login flow. Give
  // passkey-only accounts a TOTP enrollment path after password verification.
  const next = hasTotp ? 'verify' : hasPasskey || policy === 'everyone' || (policy === 'admins' && privileged) ? 'enroll' : null;

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (next ? PENDING_MINUTES * 60 * 1000 : SESSION_DAYS * 24 * 60 * 60 * 1000));
  await prisma.session.create({ data: { id: randomBytes(18).toString('base64url'), userId: user.id, tokenHash: hashToken(token), expiresAt, pending: next, challenge: null } });
  const store = await cookies();
  store.set(LEGACY_SESSION_COOKIE, token, { ...cookieOptions, maxAge: next ? PENDING_MINUTES * 60 : SESSION_DAYS * 24 * 60 * 60 });
  return next ?? 'signed-in';
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
