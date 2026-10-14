/**
 * Read-only compatibility helpers for accounts created by the legacy app.
 *
 * This module intentionally has no Prisma or framework dependency. Callers
 * supply records read from the legacy database; these helpers never create,
 * update, migrate, or delete users or sessions.
 */
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';

export const LEGACY_SESSION_COOKIE = 'msp_session';

// These values are defined by app/src/lib/crypto.ts in the legacy app.
const LEGACY_SCRYPT_COST = 16_384;
const LEGACY_SCRYPT_KEY_BYTES = 64;
const LEGACY_SCRYPT_SALT_BYTES = 16;
// Legacy validation accepts at most 200 Unicode characters.
const MAX_PASSWORD_BYTES = 800;
const LEGACY_SESSION_TOKEN_BYTES = 32;

export interface LegacyUserAuthRecord {
  id: string;
  email: string;
  passwordHash: string;
  disabledAt: Date | null;
}

export interface LegacySessionAuthRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  pending: string | null;
  user: Pick<LegacyUserAuthRecord, 'id' | 'disabledAt'>;
}

/** Validate and verify the legacy `scrypt:<N>:<salt>:<hash>` format. */
export function verifyLegacyPassword(password: string, encoded: string): boolean {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return false;
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== String(LEGACY_SCRYPT_COST)) return false;

  const salt = decodeBase64Url(parts[2]);
  const expected = decodeBase64Url(parts[3]);
  if (!salt || salt.length !== LEGACY_SCRYPT_SALT_BYTES || !expected || expected.length !== LEGACY_SCRYPT_KEY_BYTES) return false;

  try {
    const actual = scryptSync(password, salt, expected.length, { N: LEGACY_SCRYPT_COST });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Match the legacy session token storage rule: SHA-256 hex of the cookie value. */
export function hashLegacySessionToken(token: string): string | null {
  // randomToken(32) emits 43 base64url characters without padding.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const decoded = Buffer.from(token, 'base64url');
  if (decoded.length !== LEGACY_SESSION_TOKEN_BYTES || decoded.toString('base64url') !== token) return null;
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Validate an already-read legacy session without touching its row. */
export function isUsableLegacySession(
  session: LegacySessionAuthRecord | null,
  expectedUserId: string | undefined,
  now: Date = new Date(),
): session is LegacySessionAuthRecord {
  if (!session || !session.user || session.user.id !== session.userId) return false;
  if (expectedUserId !== undefined && session.userId !== expectedUserId) return false;
  return session.pending === null && session.expiresAt.getTime() > now.getTime() && session.user.disabledAt === null;
}

/** Derive the lookup key for a cookie; null means malformed or absent token. */
export function legacySessionLookupHash(cookieValue: string | null | undefined): string | null {
  if (!cookieValue) return null;
  return hashLegacySessionToken(cookieValue);
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}
