import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.FACEBOOK_APP_SECRET = 'test-app-secret';
});

const { encryptSecret, decryptSecret, hashPassword, verifyPassword, hmacHex, safeEqual } = await import(
  '../src/lib/crypto'
);

describe('token encryption', () => {
  it('round-trips a value', () => {
    const token = 'EAAG...a-facebook-page-token';
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it('produces a different ciphertext each time', () => {
    // A fresh IV per call: identical tokens must not be linkable in the database.
    const first = encryptSecret('same-value');
    const second = encryptSecret('same-value');
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe(decryptSecret(second));
  });

  it('rejects a tampered ciphertext', () => {
    const encrypted = encryptSecret('sensitive');
    const parts = encrypted.split(':');
    // Flip the last character of the payload; GCM's auth tag must catch it.
    const payload = parts[3]!;
    parts[3] = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');

    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('rejects a malformed envelope', () => {
    expect(() => decryptSecret('not-encrypted')).toThrow(/envelope/i);
  });

  it('refuses a key of the wrong length', () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
    process.env.ENCRYPTION_KEY = original;
  });
});

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', stored)).toBe(false);
  });

  it('salts each hash', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('rejects a malformed stored hash rather than throwing', () => {
    expect(verifyPassword('anything', 'garbage')).toBe(false);
  });
});

describe('hmac helpers', () => {
  it('is deterministic', () => {
    expect(hmacHex('secret', 'value')).toBe(hmacHex('secret', 'value'));
  });

  it('compares equal strings safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    // Different lengths must not throw.
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
