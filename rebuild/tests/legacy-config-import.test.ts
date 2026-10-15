import { describe, expect, it } from 'vitest';
import { legacyConfigCandidates } from '@/server/config/legacy-import';

describe('legacy Facebook configuration import plan', () => {
  it('maps a validated candidate set without exposing an encrypted secret', () => {
    const decrypt = (value: string) => value === 'encrypted-value' ? 'decoded-secret' : '';
    const candidates = legacyConfigCandidates([
      { key: 'facebook.appId', value: '12345678', encrypted: false },
      { key: 'facebook.appSecret', value: 'encrypted-value', encrypted: true },
      { key: 'facebook.graphVersion', value: 'v26.0', encrypted: false },
      { key: 'facebook.scopes', value: ['pages_show_list', 'pages_manage_posts'], encrypted: false },
      { key: 'facebook.requestTimeoutSeconds', value: 60, encrypted: false },
    ], { appUrl: 'https://example.test', decrypt });
    expect(candidates).toContainEqual({ key: 'meta.requestTimeoutMs', source: 'facebook.requestTimeoutSeconds', value: 60_000, secret: false });
    expect(candidates).toContainEqual({ key: 'meta.oauthRedirectUri', source: 'APP_URL', value: 'https://example.test/api/connections/facebook/callback', secret: false });
    expect(candidates.find(candidate => candidate.key === 'meta.appSecret')).toEqual({ key: 'meta.appSecret', source: 'facebook.appSecret', value: 'decoded-secret', secret: true });
    expect(JSON.stringify(candidates)).not.toContain('encrypted-value');
  });

  it('rejects a plaintext legacy secret and an insecure callback origin', () => {
    expect(() => legacyConfigCandidates([{ key: 'facebook.appSecret', value: 'plain', encrypted: false }], { decrypt: value => value })).toThrow(/encrypted format/);
    expect(() => legacyConfigCandidates([], { appUrl: 'http://example.test', decrypt: value => value })).toThrow(/HTTPS/);
  });

  it('plans legacy authentication policy import without embedding defaults', () => {
    expect(legacyConfigCandidates([], {
      authPolicy: 'everyone', loginAttempts: '7', loginWindowMinutes: '12', decrypt: value => value,
    })).toEqual([
      { key: 'security.twoStep', source: 'SECURITY_TWO_STEP', value: 'everyone', secret: false },
      { key: 'auth.loginAttempts', source: 'LOGIN_ATTEMPTS', value: 7, secret: false },
      { key: 'auth.loginWindowMinutes', source: 'LOGIN_WINDOW_MINUTES', value: 12, secret: false },
    ]);
  });

  it('preserves fail-closed legacy behavior for an explicitly invalid policy', () => {
    expect(legacyConfigCandidates([], { authPolicy: '', decrypt: value => value })).toContainEqual({
      key: 'security.twoStep', source: 'SECURITY_TWO_STEP', value: 'everyone', secret: false,
    });
  });
});
