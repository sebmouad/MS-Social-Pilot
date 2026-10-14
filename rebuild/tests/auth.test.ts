import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashLegacySessionToken,
  isUsableLegacySession,
  legacySessionLookupHash,
  verifyLegacyPassword,
} from '../src/server/auth';

describe('legacy credential compatibility', () => {
  it('verifies the legacy scrypt encoding and rejects malformed or oversized input', () => {
    const salt = randomBytes(16);
    const digest = scryptSync('correct horse', salt, 64, { N: 16_384 });
    const encoded = `scrypt:16384:${salt.toString('base64url')}:${digest.toString('base64url')}`;
    expect(verifyLegacyPassword('correct horse', encoded)).toBe(true);
    expect(verifyLegacyPassword('wrong horse', encoded)).toBe(false);
    expect(verifyLegacyPassword('correct horse', encoded.replace('16384', '1'))).toBe(false);
    expect(verifyLegacyPassword('x'.repeat(801), encoded)).toBe(false);
    expect(verifyLegacyPassword('correct horse', `${encoded}:extra`)).toBe(false);
  });

  it('hashes only canonical 32-byte base64url session tokens', () => {
    const token = randomBytes(32).toString('base64url');
    expect(hashLegacySessionToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(legacySessionLookupHash(token)).toBe(hashLegacySessionToken(token));
    for (const malformed of ['', 'short', `${token}=`, `${token.slice(0, -1)}!`, `${token}A`]) {
      expect(hashLegacySessionToken(malformed)).toBeNull();
    }
    expect(legacySessionLookupHash(undefined)).toBeNull();
  });

  it('fails closed for mismatched, pending, expired, disabled, or missing sessions', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const session = {
      id: 's1', userId: 'u1', tokenHash: 'hash', expiresAt: new Date(now.getTime() + 1), pending: null,
      user: { id: 'u1', disabledAt: null },
    };
    expect(isUsableLegacySession(session, 'u1', now)).toBe(true);
    expect(isUsableLegacySession(session, 'u2', now)).toBe(false);
    expect(isUsableLegacySession({ ...session, user: { ...session.user, id: 'u2' } }, undefined, now)).toBe(false);
    expect(isUsableLegacySession({ ...session, pending: 'verify' }, undefined, now)).toBe(false);
    expect(isUsableLegacySession({ ...session, expiresAt: now }, undefined, now)).toBe(false);
    expect(isUsableLegacySession({ ...session, user: { ...session.user, disabledAt: now } }, undefined, now)).toBe(false);
    expect(isUsableLegacySession(null, undefined, now)).toBe(false);
  });
});
