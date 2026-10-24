import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, matchTotp, newTotpSecret, otpauthUri, totpCode } from '../src/server/totp';

describe('TOTP compatibility', () => {
  it('matches the RFC 6238 SHA-1 six-digit test vector at 59 seconds', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, 1)).toBe('287082');
    expect(matchTotp(secret, '287082', 59_000)).toBe(1);
    expect(matchTotp(secret, '287083', 59_000)).toBeNull();
  });

  it('accepts only current or adjacent time steps and requires six numeric digits', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const at = 90_000;
    expect(matchTotp(secret, ` ${totpCode(secret, 2)} `, at)).toBe(2);
    expect(matchTotp(secret, totpCode(secret, 3), at)).toBe(3);
    expect(matchTotp(secret, totpCode(secret, 4), at)).toBe(4);
    expect(matchTotp(secret, totpCode(secret, 5), at)).toBeNull();
    expect(matchTotp(secret, '12345', at)).toBeNull();
    expect(matchTotp(secret, '12a456', at)).toBeNull();
  });

  it('generates a 160-bit base32 secret and an authenticator URI with explicit defaults', () => {
    const secret = newTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    const uri = new URL(otpauthUri({ secret, account: 'owner@example.test', issuer: 'Social Pilot' }));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(uri.pathname).toBe('/Social%20Pilot%3Aowner%40example.test');
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(uri.searchParams.get('issuer')).toBe('Social Pilot');
    expect(uri.searchParams.get('algorithm')).toBe('SHA1');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});
