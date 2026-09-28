import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The values the Meta app must be given, built from this installation's own
 * address. A redirect URI off by one character is the commonest reason nobody
 * can connect, and Facebook's error names neither URI.
 */

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.SESSION_SECRET ??= 'meta-app-test-secret-long-enough-for-the-checks';

afterEach(() => {
  delete process.env.APP_URL;
});

async function settingsFor(appUrl: string) {
  process.env.APP_URL = appUrl;
  const { metaAppSettings } = await import('../src/lib/meta-app');
  return metaAppSettings();
}

const value = (settings: Awaited<ReturnType<typeof settingsFor>>, key: string) =>
  settings.fields.find((field) => field.key === key)?.value;

describe('metaAppSettings', () => {
  it('gives the exact URLs the app sends and Meta calls back', async () => {
    const settings = await settingsFor('https://social.example.com');
    expect(value(settings, 'appDomain')).toBe('social.example.com');
    expect(value(settings, 'redirectUri')).toBe('https://social.example.com/api/facebook/callback');
    expect(value(settings, 'deauthorize')).toBe('https://social.example.com/api/facebook/deauthorize');
    expect(value(settings, 'dataDeletion')).toBe('https://social.example.com/api/facebook/data-deletion');
    expect(settings.warnings).toEqual([]);
  });

  it('does not double a slash somebody left on the end of APP_URL', async () => {
    const settings = await settingsFor('https://social.example.com/');
    expect(value(settings, 'redirectUri')).toBe('https://social.example.com/api/facebook/callback');
  });

  it('warns about an address Facebook will not accept for real users', async () => {
    const settings = await settingsFor('http://localhost:3000');
    expect(settings.warnings).toEqual(['notHttps', 'loopback']);
  });

  it('names the pinned Graph version and the permissions actually requested', async () => {
    const settings = await settingsFor('https://social.example.com');
    expect(value(settings, 'graphVersion')).toMatch(/^v\d+\.0$/);
    expect(value(settings, 'permissions')).toContain('pages_manage_posts');
    expect(value(settings, 'permissions')).not.toContain('publish_to_groups');
  });
});
