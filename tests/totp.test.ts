import { describe, expect, it } from 'vitest';

import { base32Decode, base32Encode, matchTotp, otpauthUri, timeStep, totpCode } from '@/lib/totp';

// RFC 6238 appendix B, SHA-1: the ASCII secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('authenticator codes', () => {
  it('match the RFC 6238 test vectors (last six digits)', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(RFC_SECRET, timeStep(59_000))).toBe('287082');
    expect(totpCode(RFC_SECRET, timeStep(1_111_111_109_000))).toBe('081804');
    expect(totpCode(RFC_SECRET, timeStep(2_000_000_000_000))).toBe('279037');
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 7, 9]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('accepts one step either side for a clock that is a little off, and no more', () => {
    const at = 1_700_000_000_000;
    const step = timeStep(at);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), at)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), at)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 3), at)).toBeNull();
    expect(matchTotp(RFC_SECRET, 'abcdef', at)).toBeNull();
  });

  it('builds the URI authenticator apps scan', () => {
    const uri = otpauthUri({ secret: RFC_SECRET, account: 'a@example.test', issuer: 'app.example.test' });
    expect(uri).toMatch(/^otpauth:\/\/totp\/app\.example\.test%3Aa%40example\.test\?/);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
  });
});
