import { describe, expect, it } from 'vitest';
import { hashLegacyPassword, verifyLegacyPassword } from '../src/server/auth';
import { validateNewPassword, validateProfileName } from '../src/server/account-settings';

describe('account settings validation', () => {
  it('trims and bounds profile names', () => {
    expect(validateProfileName('  Samira  ')).toBe('Samira');
    expect(validateProfileName('  ')).toBeNull();
    expect(validateProfileName('x'.repeat(101))).toBeNull();
    expect(validateProfileName(null)).toBeNull();
  });

  it('requires a sufficiently long password while respecting the legacy byte limit', () => {
    expect(validateNewPassword('short')).toBe(false);
    expect(validateNewPassword('a'.repeat(12))).toBe(true);
    expect(validateNewPassword('é'.repeat(401))).toBe(false);
  });

  it('hashes new passwords in the existing sign-in format without storing the cleartext', () => {
    const password = 'correct horse battery staple';
    const hash = hashLegacyPassword(password);
    expect(hash).toMatch(/^scrypt:16384:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(hash).not.toContain(password);
    expect(verifyLegacyPassword(password, hash)).toBe(true);
    expect(verifyLegacyPassword('wrong password', hash)).toBe(false);
  });
});
