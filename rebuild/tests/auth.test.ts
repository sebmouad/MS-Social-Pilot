import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashSessionToken,
  isUsableSession,
  sessionLookupHash,
  verifyPassword,
} from '../src/server/auth';

describe('legacy credential compatibility', () => {
  it('verifies the legacy scrypt encoding and rejects malformed or oversized input', () => {
    const salt = randomBytes(16);
    const digest = scryptSync('correct horse', salt, 64, { N: 16_384 });
    const encoded = `scrypt:16384:${salt.toString('base64url')}:${digest.toString('base64url')}`;
    expect(verifyPassword('correct horse', encoded)).toBe(true);
    expect(verifyPassword('wrong horse', encoded)).toBe(false);
    expect(verifyPassword('correct horse', encoded.replace('16384', '1'))).toBe(false);
    expect(verifyPassword('x'.repeat(801), encoded)).toBe(false);
    expect(verifyPassword('correct horse', `${encoded}:extra`)).toBe(false);
  });

  it('hashes only canonical 32-byte base64url session tokens', () => {
    const token = randomBytes(32).toString('base64url');
    expect(hashSessionToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(sessionLookupHash(token)).toBe(hashSessionToken(token));
    for (const malformed of ['', 'short', `${token}=`, `${token.slice(0, -1)}!`, `${token}A`]) {
      expect(hashSessionToken(malformed)).toBeNull();
    }
    expect(sessionLookupHash(undefined)).toBeNull();
  });

  it('fails closed for mismatched, pending, expired, disabled, or missing sessions', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const session = {
      id: 's1', userId: 'u1', tokenHash: 'hash', expiresAt: new Date(now.getTime() + 1), pending: null,
      user: { id: 'u1', disabledAt: null },
    };
    expect(isUsableSession(session, 'u1', now)).toBe(true);
    expect(isUsableSession(session, 'u2', now)).toBe(false);
    expect(isUsableSession({ ...session, user: { ...session.user, id: 'u2' } }, undefined, now)).toBe(false);
    expect(isUsableSession({ ...session, pending: 'verify' }, undefined, now)).toBe(false);
    expect(isUsableSession({ ...session, expiresAt: now }, undefined, now)).toBe(false);
    expect(isUsableSession({ ...session, user: { ...session.user, disabledAt: now } }, undefined, now)).toBe(false);
    expect(isUsableSession(null, undefined, now)).toBe(false);
  });
});
