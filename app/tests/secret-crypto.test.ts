import { afterEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/server/secret-crypto';

const originalKey = process.env.ENCRYPTION_KEY;
const validKey = Buffer.alloc(32, 7).toString('base64');

afterEach(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

describe('encrypted secret envelope', () => {
  it('round trips secrets while using a fresh nonce for each write', () => {
    process.env.ENCRYPTION_KEY = validKey;
    const first = encryptSecret('totp-secret-value');
    const second = encryptSecret('totp-secret-value');
    expect(first).not.toBe(second);
    expect(first.split(':')).toHaveLength(4);
    expect(decryptSecret(first)).toBe('totp-secret-value');
  });

  it('rejects absent or incorrectly sized keys before encrypting or decrypting', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptSecret('secret')).toThrow(/unavailable/);
    process.env.ENCRYPTION_KEY = Buffer.alloc(31).toString('base64');
    expect(() => encryptSecret('secret')).toThrow(/invalid length/);
    expect(() => decryptSecret('v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:')).toThrow(/invalid length/);
  });

  it('rejects unknown versions, malformed envelopes, and ciphertext tampering', () => {
    process.env.ENCRYPTION_KEY = validKey;
    expect(() => decryptSecret('v2:a:b:c')).toThrow(/Unknown/);
    expect(() => decryptSecret('v1:short:short:')).toThrow(/Malformed/);
    const encrypted = encryptSecret('secret');
    const parts = encrypted.split(':');
    const bytes = Buffer.from(parts[3], 'base64url');
    bytes[0] ^= 1;
    parts[3] = bytes.toString('base64url');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });
});
