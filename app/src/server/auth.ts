/**
 * Read-only compatibility helpers for persisted accounts.
 *
 * This module intentionally has no Prisma or framework dependency. Callers
 * supply persisted database records; these helpers never create,
 * update, migrate, or delete users or sessions.
 */
import { synchronousPolicy } from './synchronous-policy';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'msp_session';

// Persisted scrypt and session formats are authentication protocol invariants.
const SCRYPT_COST = 16_384;
const SCRYPT_KEY_BYTES = 64;
const SCRYPT_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;

export interface StoredUserAuthRecord {
  id: string;
  email: string;
  passwordHash: string;
  disabledAt: Date | null;
}

export interface StoredSessionAuthRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  pending: string | null;
  user: Pick<StoredUserAuthRecord, 'id' | 'disabledAt'>;
}

/** Validate and verify the stored `scrypt:<N>:<salt>:<hash>` format. */
export function verifyPassword(password: string, encoded: string): boolean {
  // A lower new-password policy must not invalidate already accepted stored passwords.
  const maxBytes = Math.max(synchronousPolicy('auth.passwordMaxBytes'), synchronousPolicy('auth.passwordVerificationMaxBytes'));
  if (Buffer.byteLength(password, 'utf8') > maxBytes) return false;
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== String(SCRYPT_COST)) return false;

  const salt = decodeBase64Url(parts[2]);
  const expected = decodeBase64Url(parts[3]);
  if (!salt || salt.length !== SCRYPT_SALT_BYTES || !expected || expected.length !== SCRYPT_KEY_BYTES) return false;

  try {
    const actual = scryptSync(password, salt, expected.length, { N: SCRYPT_COST });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Create a password hash using the format accepted by the existing sign-in flow. */
export function hashStoredPassword(password: string): string {
  if (Buffer.byteLength(password, 'utf8') > synchronousPolicy('auth.passwordMaxBytes')) throw new Error('Password is too long.');
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const digest = scryptSync(password, salt, SCRYPT_KEY_BYTES, { N: SCRYPT_COST });
  return `scrypt:${SCRYPT_COST}:${salt.toString('base64url')}:${digest.toString('base64url')}`;
}

/** Match the stored session token storage rule: SHA-256 hex of the cookie value. */
export function hashSessionToken(token: string): string | null {
  // randomToken(32) emits 43 base64url characters without padding.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const decoded = Buffer.from(token, 'base64url');
  if (decoded.length !== SESSION_TOKEN_BYTES || decoded.toString('base64url') !== token) return null;
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Validate an already-read stored session without touching its row. */
export function isUsableSession(
  session: StoredSessionAuthRecord | null,
  expectedUserId: string | undefined,
  now: Date = new Date(),
): session is StoredSessionAuthRecord {
  if (!session || !session.user || session.user.id !== session.userId) return false;
  if (expectedUserId !== undefined && session.userId !== expectedUserId) return false;
  return session.pending === null && session.expiresAt.getTime() > now.getTime() && session.user.disabledAt === null;
}

/** Derive the lookup key for a cookie; null means malformed or absent token. */
export function sessionLookupHash(cookieValue: string | null | undefined): string | null {
  if (!cookieValue) return null;
  return hashSessionToken(cookieValue);
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}
